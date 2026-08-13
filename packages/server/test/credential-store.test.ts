import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCredentialStore } from '../src/credential-store.js';

const PASSWORD = 'correct horse battery staple';
const KEY = 'sk-test-credential-store-sentinel';

const sandboxes: string[] = [];

afterEach(() => {
  for (const directory of sandboxes.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const makeStore = () => {
  const directory = mkdtempSync(join(tmpdir(), 'harness-credential-test-'));
  sandboxes.push(directory);
  return {
    directory,
    filePath: join(directory, 'credentials.enc'),
    store: createCredentialStore({ filePath: join(directory, 'credentials.enc') }),
  };
};

describe('master-password credential store', () => {
  it('initializes, unlocks, reads, updates, locks, and deletes a versioned credential', () => {
    const { filePath, store } = makeStore();

    expect(store.getState()).toBe('empty');
    expect(() => store.initialize('short')).toThrow('MASTER_PASSWORD_TOO_SHORT');
    store.initialize(PASSWORD);
    expect(store.getState()).toBe('unlocked');
    store.setKey('harness/deepseek-api-key', KEY);
    expect(store.getKey('harness/deepseek-api-key')).toBe(KEY);
    expect(JSON.parse(readFileSync(filePath, 'utf8')).version).toBe(2);

    store.lock();
    expect(store.getState()).toBe('locked');
    expect(store.getKey('harness/deepseek-api-key')).toBeNull();
    expect(() => store.setKey('harness/deepseek-api-key', KEY)).toThrow('CREDENTIAL_STORE_LOCKED');
    expect(store.unlock('wrong password')).toBe(false);
    expect(store.unlock(PASSWORD)).toBe(true);
    expect(store.getKey('harness/deepseek-api-key')).toBe(KEY);
    store.deleteKey('harness/deepseek-api-key');
    expect(store.getState()).toBe('empty');
  });

  it('rejects invalid passwords and detects legacy files without decrypting them', () => {
    const { filePath, store } = makeStore();
    expect(() => store.initialize('12345678901')).toThrow('MASTER_PASSWORD_TOO_SHORT');
    store.initialize(PASSWORD);
    expect(store.unlock('x'.repeat(128) + 'x')).toBe(false);

    rmSync(filePath, { force: true });
    // An old machine-derived store was a raw base64 payload without a JSON envelope.
    writeFileSync(filePath, Buffer.from('legacy-ciphertext').toString('base64'));
    const legacy = createCredentialStore({ filePath });
    expect(legacy.getState()).toBe('legacy');
    expect(legacy.getKey('harness/deepseek-api-key')).toBeNull();
  });

  it('reads an unlocked credential prefix in one encrypted-envelope snapshot', () => {
    const { store } = makeStore();
    store.initialize(PASSWORD);
    store.setKey('harness/provider/one', 'fake-provider-record-one');
    store.setKey('harness/provider/two', 'fake-provider-record-two');
    store.setKey('harness/deepseek-api-key', KEY);

    expect(store.getKeys?.('harness/provider/')).toEqual({
      'harness/provider/one': 'fake-provider-record-one',
      'harness/provider/two': 'fake-provider-record-two',
    });
  });
});
