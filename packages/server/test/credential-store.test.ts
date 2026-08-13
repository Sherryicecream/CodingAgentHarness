import { describe, expect, it } from 'vitest';
import {
  createCredentialStore,
  type CredentialKeyring,
} from '../src/credential-store.js';

const KEY = 'sk-test-credential-store-sentinel';

class FakeKeyring implements CredentialKeyring {
  readonly entries = new Map<string, string>();
  unavailable = false;

  get(service: string, account: string): string | null {
    if (this.unavailable) throw new Error('KEYRING_UNAVAILABLE');
    return this.entries.get(`${service}/${account}`) ?? null;
  }

  set(service: string, account: string, secret: string): void {
    if (this.unavailable) throw new Error('KEYRING_UNAVAILABLE');
    this.entries.set(`${service}/${account}`, secret);
  }

  delete(service: string, account: string): boolean {
    if (this.unavailable) throw new Error('KEYRING_UNAVAILABLE');
    return this.entries.delete(`${service}/${account}`);
  }
}

describe('OS-keyring credential store', () => {
  it('stores, updates, reads, and deletes the DeepSeek key without returning it in status', async () => {
    const keyring = new FakeKeyring();
    const store = createCredentialStore({ keyring });

    expect(store.status()).toEqual({ storage: 'keyring', hasKey: false });
    await store.setKey(KEY);
    expect(store.getKey()).toBe(KEY);
    expect(store.status()).toEqual({ storage: 'keyring', hasKey: true });
    expect(JSON.stringify(await store.status())).not.toContain(KEY);

    await store.setKey('sk-test-updated-sentinel');
    expect(store.getKey()).toBe('sk-test-updated-sentinel');
    expect(store.deleteKey()).toBe(true);
    expect(store.getKey()).toBeNull();
  });

  it('reports an unavailable keyring and never creates a file fallback', async () => {
    const keyring = new FakeKeyring();
    keyring.unavailable = true;
    const store = createCredentialStore({ keyring });

    expect(store.status()).toEqual({ storage: 'unavailable', hasKey: false });
    expect(() => store.setKey(KEY)).toThrow('KEYRING_UNAVAILABLE');
    expect(store.getKey()).toBeNull();
  });
});
