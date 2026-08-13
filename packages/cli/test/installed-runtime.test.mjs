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

const waitForPortToClose = async (url) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${url}/api/health`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    } catch {
      return;
    }
  }
  throw new Error(`server continued listening after CLI shutdown: ${url}`);
};

const stopProcessTree = async (child, url) => {
  if (!child || child.exitCode !== null) {
    await waitForPortToClose(url);
    return;
  }
  child.kill();
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  }
  await waitForPortToClose(url);
};

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
  const npmEnvironment = {
    ...process.env,
    npm_config_audit: 'false',
    npm_config_prefer_offline: 'true',
  };
  let child;
  let expectedUrl;
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
    child = spawn(process.execPath, [cliEntry], {
      cwd: installDirectory,
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
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
    const webUiResponse = await fetch(expectedUrl);
    assert.equal(webUiResponse.status, 200);
    assert.match(await webUiResponse.text(), /<div id="root"><\/div>/);
  } finally {
    if (expectedUrl) {
      await stopProcessTree(child, expectedUrl);
    }
    await Promise.all([
      rm(packedDirectory, { recursive: true, force: true }),
      rm(installDirectory, { recursive: true, force: true }),
    ]);
  }
});
