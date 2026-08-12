import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const LOOPBACK_HOST = '127.0.0.1';
const FAKE_MASTER_PASSWORD = 'temporary test password only';
const INITIAL_FAKE_KEY = 'sk-fake-temporary-initial-only';
const REPLACEMENT_FAKE_KEY = 'sk-fake-temporary-replacement-only';
const sandboxes: string[] = [];
const requireFromTest = createRequire(import.meta.url);

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

const reserveEphemeralPort = (): Promise<number> => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, LOOPBACK_HOST, () => {
    const address = probe.address();
    if (!address || typeof address === 'string') {
      probe.close();
      reject(new Error('EPHEMERAL_PORT_UNAVAILABLE'));
      return;
    }
    probe.close((error) => error ? reject(error) : resolve(address.port));
  });
});

const stopChild = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000)),
  ]);
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
};

const waitForHealth = async (
  baseUrl: string,
  child: ChildProcess,
  getStderr: () => string,
): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`SERVER_EXITED_BEFORE_HEALTH_CHECK: ${getStderr()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The loopback listener may not be ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`SERVER_HEALTH_CHECK_TIMEOUT: ${getStderr()}`);
};

const requestJson = async (
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  return { status: response.status, body: await response.json() };
};

const expectNoPlaintext = (value: unknown): void => {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  expect(serialized).not.toContain(FAKE_MASTER_PASSWORD);
  expect(serialized).not.toContain(INITIAL_FAKE_KEY);
  expect(serialized).not.toContain(REPLACEMENT_FAKE_KEY);
};

it('uses the configured temporary credential file for the localhost lifecycle', { timeout: 20_000 }, async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'harness-server-credential-lifecycle-'));
  sandboxes.push(sandbox);
  const credentialsFile = join(sandbox, 'configured', 'credentials.enc');
  const fallbackHome = join(sandbox, 'fallback-home');
  const fallbackCredentialsFile = join(fallbackHome, '.harness', 'credentials.enc');
  const port = await reserveEphemeralPort();
  const baseUrl = `http://${LOOPBACK_HOST}:${port}`;
  const serverSource = new URL('../src/server.ts', import.meta.url).href;
  const tsxApi = pathToFileURL(requireFromTest.resolve('tsx/esm/api')).href;
  const bootstrap = join(sandbox, 'start-server.mjs');
  writeFileSync(bootstrap, [
    "import os from 'node:os';",
    `os.userInfo = () => (${JSON.stringify({
      uid: -1,
      gid: -1,
      username: 'harness-temporary-test',
      homedir: fallbackHome,
      shell: null,
    })});`,
    `if (os.homedir() !== ${JSON.stringify(fallbackHome)}) throw new Error('TEST_HOME_NOT_ISOLATED');`,
    `const { register } = await import(${JSON.stringify(tsxApi)});`,
    'register();',
    `const { startServer } = await import(${JSON.stringify(serverSource)});`,
    'await startServer();',
  ].join('\n'));
  let stderr = '';
  const child = spawn(process.execPath, [bootstrap], {
    cwd: sandbox,
    env: {
      HOME: fallbackHome,
      USERPROFILE: fallbackHome,
      USERNAME: process.env.USERNAME,
      USERDOMAIN: process.env.USERDOMAIN,
      ComSpec: process.env.ComSpec,
      PATH: process.env.PATH,
      PATHEXT: process.env.PATHEXT,
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      APPDATA: join(sandbox, 'app-data'),
      LOCALAPPDATA: join(sandbox, 'local-app-data'),
      TEMP: sandbox,
      TMP: sandbox,
      HARNESS_MODE: 'local',
      HARNESS_CREDENTIALS_FILE: credentialsFile,
      HARNESS_WORKSPACE_ROOT: join(sandbox, 'workspaces'),
      HOST: LOOPBACK_HOST,
      PORT: String(port),
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

  try {
    await waitForHealth(baseUrl, child, () => stderr);
    const emptyStatus = await requestJson(baseUrl, '/api/config/status');
    expect(emptyStatus).toEqual({
      status: 200,
      body: { hasKey: false, source: 'none', state: 'empty' },
    });
    expectNoPlaintext(emptyStatus.body);

    const initialized = await requestJson(baseUrl, '/api/config/key', {
      method: 'POST',
      body: JSON.stringify({
        key: INITIAL_FAKE_KEY,
        masterPassword: FAKE_MASTER_PASSWORD,
      }),
    });
    expect(initialized.status).toBe(200);
    expectNoPlaintext(initialized.body);
    expect(existsSync(credentialsFile), 'configured credential file should be created').toBe(true);
    expect(existsSync(fallbackCredentialsFile), 'fallback credential file should remain unused').toBe(false);

    const initialEnvelope = readFileSync(credentialsFile, 'utf8');
    expectNoPlaintext(initialEnvelope);
    expect(JSON.parse(initialEnvelope)).toMatchObject({ version: 2 });

    const initializedStatus = await requestJson(baseUrl, '/api/config/status');
    expect(initializedStatus).toEqual({
      status: 200,
      body: { hasKey: true, source: 'file', state: 'unlocked' },
    });
    expectNoPlaintext(initializedStatus.body);

    const updated = await requestJson(baseUrl, '/api/config/key', {
      method: 'POST',
      body: JSON.stringify({ key: REPLACEMENT_FAKE_KEY }),
    });
    expect(updated.status).toBe(200);
    expectNoPlaintext(updated.body);
    const updatedEnvelope = readFileSync(credentialsFile, 'utf8');
    expect(updatedEnvelope).not.toBe(initialEnvelope);
    expect(Object.keys(JSON.parse(updatedEnvelope).entries)).toEqual(['harness/deepseek-api-key']);
    expectNoPlaintext(updatedEnvelope);

    const updatedStatus = await requestJson(baseUrl, '/api/config/status');
    expect(updatedStatus).toEqual({
      status: 200,
      body: { hasKey: true, source: 'file', state: 'unlocked' },
    });
    expectNoPlaintext(updatedStatus.body);

    const locked = await requestJson(baseUrl, '/api/config/lock', { method: 'POST' });
    expect(locked).toEqual({ status: 200, body: { status: 'locked' } });
    expectNoPlaintext(locked.body);
    const lockedStatus = await requestJson(baseUrl, '/api/config/status');
    expect(lockedStatus).toEqual({
      status: 200,
      body: { hasKey: true, source: 'file', state: 'locked' },
    });
    expectNoPlaintext(lockedStatus.body);

    const unlocked = await requestJson(baseUrl, '/api/config/unlock', {
      method: 'POST',
      body: JSON.stringify({ masterPassword: FAKE_MASTER_PASSWORD }),
    });
    expect(unlocked).toEqual({ status: 200, body: { status: 'unlocked' } });
    expectNoPlaintext(unlocked.body);

    const cleared = await requestJson(baseUrl, '/api/config/key', { method: 'DELETE' });
    expect(cleared.status).toBe(200);
    expectNoPlaintext(cleared.body);
    expect(existsSync(credentialsFile)).toBe(false);
    const clearedStatus = await requestJson(baseUrl, '/api/config/status');
    expect(clearedStatus).toEqual({
      status: 200,
      body: { hasKey: false, source: 'none', state: 'empty' },
    });
    expectNoPlaintext(clearedStatus.body);
  } finally {
    await stopChild(child);
  }
});
