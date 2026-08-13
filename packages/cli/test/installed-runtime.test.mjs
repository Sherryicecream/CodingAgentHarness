import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const packageDirectories = ['core', 'server', 'cli'];
const npmCli = process.env.npm_execpath
  ?? (process.platform === 'win32'
    ? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : undefined);
const serverDirectory = join(repositoryRoot, 'packages', 'server');
const credentialEnvironmentName = /(?:api[_-]?key|access[_-]?key|token|secret|password|credential|authorization)/i;

const withoutCredentialEnvironment = (environment) => Object.fromEntries(
  Object.entries(environment).filter(([name]) => !credentialEnvironmentName.test(name)),
);

const runNpm = (args, options = {}) => {
  const command = npmCli ? process.execPath : 'npm';
  const commandArgs = npmCli ? [npmCli, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    ...options,
  });
  assert.equal(result.status, 0, `${command} ${commandArgs.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}\n${result.stderr}`;
};

const waitForResponse = async (url, child, output, path = '/') => {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await fetch(`${url}${path}`);
    } catch (error) {
      lastError = error;
      if (child.exitCode !== null) {
        throw new Error(`harness exited with ${child.exitCode}\n${output()}`);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }
  throw new Error(`harness did not answer at ${url}${path}\n${output()}\n${lastError}`);
};

const waitForPortToClose = async (url, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  let consecutiveFailures = 0;
  while (Date.now() < deadline) {
    try {
      await fetch(`${url}/api/health`);
      consecutiveFailures = 0;
    } catch {
      consecutiveFailures += 1;
      if (consecutiveFailures === 3) {
        return;
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`server continued listening after CLI shutdown: ${url}`);
};

const waitForExit = (child, timeoutMs) => new Promise((resolveExit, rejectExit) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    resolveExit();
    return;
  }
  const timeout = setTimeout(() => {
    rejectExit(new Error(`CLI did not exit after termination: ${child.pid}`));
  }, timeoutMs);
  child.once('exit', () => {
    clearTimeout(timeout);
    resolveExit();
  });
  child.once('error', (error) => {
    clearTimeout(timeout);
    rejectExit(error);
  });
});

const stopProcessTree = async (child, url, timeoutMs = 10_000) => {
  if (!child || child.exitCode !== null) {
    await waitForPortToClose(url, timeoutMs);
    return;
  }
  child.kill();
  try {
    await waitForExit(child, timeoutMs);
    await waitForPortToClose(url, timeoutMs);
  } catch (lifecycleError) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
    throw lifecycleError;
  }
};

const cleanupPackedRuntime = async (child, url, directories, timeoutMs = 10_000) => {
  let failure;
  if (url) {
    try {
      await stopProcessTree(child, url, timeoutMs);
    } catch (error) {
      failure = error;
    }
  }
  const removalResults = await Promise.allSettled(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
  if (!failure) {
    failure = removalResults.find((result) => result.status === 'rejected')?.reason;
  }
  return failure;
};

test('Windows cleanup reports a descendant server left listening after normal CLI termination', {
  skip: process.platform !== 'win32',
  timeout: 30_000,
}, async () => {
  const port = 31_000 + Math.floor(Math.random() * 1_000);
  const url = `http://127.0.0.1:${port}`;
  const packedDirectory = await mkdtemp(join(tmpdir(), 'harness-orphan-packed-'));
  const installDirectory = await mkdtemp(join(tmpdir(), 'harness-orphan-installed-'));
  const serverScript = [
    "const { createServer } = require('node:http');",
    "createServer((_request, response) => response.end('ok')).listen(Number(process.env.PORT), '127.0.0.1');",
  ].join('');
  const wrapperScript = [
    "const { spawn } = require('node:child_process');",
    "const server = spawn(process.execPath, ['-e', process.env.SERVER_SCRIPT], { detached: true, env: process.env, stdio: 'ignore' });",
    'console.log(server.pid);',
    'setInterval(() => undefined, 1_000);',
  ].join('');
  const wrapper = spawn(process.execPath, ['-e', wrapperScript], {
    env: { ...process.env, PORT: String(port), SERVER_SCRIPT: serverScript },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  wrapper.stdout.on('data', (chunk) => { output += chunk.toString(); });
  wrapper.stderr.on('data', (chunk) => { output += chunk.toString(); });
  let serverPid;
  try {
    await waitForResponse(url, wrapper, () => output);
    serverPid = Number(output.trim().split(/\s+/)[0]);
    assert.ok(Number.isSafeInteger(serverPid) && serverPid > 0, output);
    const cleanupFailure = await cleanupPackedRuntime(
      wrapper,
      url,
      [packedDirectory, installDirectory],
      1_000,
    );
    assert.match(cleanupFailure?.message ?? '', new RegExp(`server continued listening after CLI shutdown: ${url}`));
    await assert.rejects(readFile(packedDirectory), { code: 'ENOENT' });
    await assert.rejects(readFile(installDirectory), { code: 'ENOENT' });
  } finally {
    wrapper.kill();
    if (serverPid) {
      spawnSync('taskkill', ['/pid', String(serverPid), '/t', '/f'], { stdio: 'ignore' });
    }
    await waitForPortToClose(url);
  }
});

test('server build removes stale chunks before they can be packed', { timeout: 30_000 }, async () => {
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'harness-pack-cache-'));
  const staleChunk = 'privileged-agent-run-stale.js';
  try {
    runNpm(['run', 'build', '--workspace', '@harness/server']);
    await writeFile(join(serverDirectory, 'dist', staleChunk), 'stale build output');
    runNpm(['run', 'build', '--workspace', '@harness/server']);
    const serverManifest = JSON.parse(runNpm(['pack', '--dry-run', '--json'], {
      cwd: serverDirectory,
      env: { ...process.env, npm_config_cache: cacheDirectory },
    }));
    assert.doesNotMatch(
      serverManifest[0].files.map((file) => file.path).join('\n'),
      new RegExp(staleChunk),
    );
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});

test('CLI bin metadata names a Node entry rather than a Windows command wrapper', async () => {
  const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'packages', 'cli', 'package.json'), 'utf8'));
  assert.equal(packageJson.bin.harness, './dist/cli.js');
  assert.match(packageJson.bin.harness, /\.js$/);
});

test('packed CLI node entry serves health JSON and the packaged Web UI', { timeout: 60_000 }, async () => {
  const packedDirectory = await mkdtemp(join(tmpdir(), 'harness-packed-'));
  const installDirectory = await mkdtemp(join(tmpdir(), 'harness-installed-'));
  const credentialsFile = join(installDirectory, 'credentials', 'credentials.enc');
  const npmEnvironment = {
    ...process.env,
    npm_config_audit: 'false',
    npm_config_prefer_offline: 'true',
  };
  let child;
  let expectedUrl;
  let testFailure;
  try {
    runNpm(['run', 'build', '--workspace', '@harness/core']);
    runNpm(['run', 'build', '--workspace', '@harness/server']);
    runNpm(['run', 'build', '--workspace', '@harness/cli']);

    for (const packageDirectory of packageDirectories) {
      runNpm(['pack', '--pack-destination', packedDirectory], {
        cwd: join(repositoryRoot, 'packages', packageDirectory),
        env: npmEnvironment,
      });
    }
    const packageTarballs = (await readdir(packedDirectory))
      .filter((name) => name.endsWith('.tgz'))
      .map((name) => join(packedDirectory, name));
    runNpm(['init', '--yes'], { cwd: installDirectory, env: npmEnvironment });
    runNpm(['install', '--ignore-scripts', ...packageTarballs], {
      cwd: installDirectory,
      env: npmEnvironment,
      timeout: 50_000,
    });

    const port = 31_000 + Math.floor(Math.random() * 1_000);
    expectedUrl = `http://127.0.0.1:${port}`;
    const installedCliPackage = JSON.parse(await readFile(
      join(installDirectory, 'node_modules', '@harness', 'cli', 'package.json'),
      'utf8',
    ));
    const cliEntry = join(
      installDirectory,
      'node_modules',
      '@harness',
      'cli',
      installedCliPackage.bin.harness,
    );
    const inheritedEnvironment = {
      ...process.env,
      DEEPSEEK_API_KEY: 'sk-fake-parent-environment-regression-only',
    };
    child = spawn(process.execPath, [cliEntry], {
      cwd: installDirectory,
      env: {
        ...withoutCredentialEnvironment(inheritedEnvironment),
        HARNESS_CREDENTIALS_FILE: credentialsFile,
        HOST: '127.0.0.1',
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    const outputValue = () => output;
    await waitForResponse(expectedUrl, child, outputValue, '/api/health');
    assert.doesNotMatch(output, /MODULE_NOT_FOUND|Missing script: "start"/);
    const healthResponse = await fetch(`${expectedUrl}/api/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), { status: 'ok', mode: 'local' });
    const configResponse = await fetch(`${expectedUrl}/api/config/status`);
    assert.equal(configResponse.status, 200);
    assert.deepEqual(await configResponse.json(), { hasKey: false, source: 'none', state: 'empty' });
    await assert.rejects(readFile(credentialsFile), { code: 'ENOENT' });
    const webUiResponse = await fetch(expectedUrl);
    assert.equal(webUiResponse.status, 200);
    assert.match(await webUiResponse.text(), /<div id="root"><\/div>/);
  } catch (error) {
    testFailure = error;
  } finally {
    const cleanupFailure = await cleanupPackedRuntime(
      child,
      expectedUrl,
      [packedDirectory, installDirectory],
    );
    if (testFailure) {
      throw testFailure;
    }
    if (cleanupFailure) {
      throw cleanupFailure;
    }
  }
});
