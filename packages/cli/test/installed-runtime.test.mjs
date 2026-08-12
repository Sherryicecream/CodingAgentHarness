import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const packageDirectories = ['core', 'server', 'cli'];
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const serverDirectory = join(repositoryRoot, 'packages', 'server');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...options,
  });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}\n${result.stderr}`;
};

const waitForStartup = (child, expectedUrl) => new Promise((resolveStartup, rejectStartup) => {
  let output = '';
  const timeout = setTimeout(() => {
    rejectStartup(new Error(`harness did not start at ${expectedUrl}\n${output}`));
  }, 15_000);
  const collect = (chunk) => {
    output += chunk.toString();
    if (output.includes(`Harness server started: ${expectedUrl}`)) {
      clearTimeout(timeout);
      resolveStartup(output);
    }
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('error', (error) => {
    clearTimeout(timeout);
    rejectStartup(error);
  });
  child.on('exit', (code) => {
    clearTimeout(timeout);
    rejectStartup(new Error(`harness exited with ${code}\n${output}`));
  });
});

test('server build removes stale chunks before they can be packed', { timeout: 30_000 }, async () => {
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'harness-pack-cache-'));
  const staleChunk = 'privileged-agent-run-stale.js';
  try {
    run(npmCommand, ['run', 'build', '--workspace', '@harness/server']);
    await writeFile(join(serverDirectory, 'dist', staleChunk), 'stale build output');
    run(npmCommand, ['run', 'build', '--workspace', '@harness/server']);
    const serverManifest = JSON.parse(run(npmCommand, ['pack', '--dry-run', '--json'], {
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

test('packed CLI starts the installed server on localhost', { timeout: 60_000 }, async () => {
  const packedDirectory = await mkdtemp(join(tmpdir(), 'harness-packed-'));
  const installDirectory = await mkdtemp(join(tmpdir(), 'harness-installed-'));
  const npmEnvironment = {
    ...process.env,
    npm_config_cache: join(installDirectory, 'npm-cache'),
  };
  let child;
  try {
    run(npmCommand, ['run', 'build', '--workspace', '@harness/core']);
    run(npmCommand, ['run', 'build', '--workspace', '@harness/server']);
    run(npmCommand, ['run', 'build', '--workspace', '@harness/cli']);

    for (const packageDirectory of packageDirectories) {
      run(npmCommand, ['pack', '--pack-destination', packedDirectory], {
        cwd: join(repositoryRoot, 'packages', packageDirectory),
        env: npmEnvironment,
      });
    }
    const packageTarballs = (await readdir(packedDirectory))
      .filter((name) => name.endsWith('.tgz'))
      .map((name) => join(packedDirectory, name));
    run(npmCommand, ['init', '--yes'], { cwd: installDirectory, env: npmEnvironment });
    run(npmCommand, ['install', '--ignore-scripts', ...packageTarballs], {
      cwd: installDirectory,
      env: npmEnvironment,
    });

    const port = 31_000 + Math.floor(Math.random() * 1_000);
    const expectedUrl = `http://127.0.0.1:${port}`;
    const executable = process.platform === 'win32'
      ? join(installDirectory, 'node_modules', '.bin', 'harness.cmd')
      : join(installDirectory, 'node_modules', '.bin', 'harness');
    child = spawn(executable, [], {
      cwd: installDirectory,
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = await waitForStartup(child, expectedUrl);
    assert.doesNotMatch(output, /MODULE_NOT_FOUND|Missing script: "start"/);
    const response = await fetch(expectedUrl);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<div id="root"><\/div>/);
  } finally {
    child?.kill();
    await Promise.all([
      rm(packedDirectory, { recursive: true, force: true }),
      rm(installDirectory, { recursive: true, force: true }),
    ]);
  }
});
