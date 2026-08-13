import type { CredentialKeyring } from './credential-store.js';

interface NativeEntry {
  getPassword(): string;
  setPassword(secret: string): void;
  deletePassword(): void;
}

interface NativeKeyringModule {
  Entry: new (service: string, account: string) => NativeEntry;
}

const unavailableError = (): Error => new Error('Operating-system credential storage is unavailable');

export const createUnavailableCredentialKeyring = (): CredentialKeyring => ({
  get() {
    throw unavailableError();
  },
  set() {
    throw unavailableError();
  },
  delete() {
    throw unavailableError();
  },
});

export const createNativeCredentialKeyring = async (): Promise<CredentialKeyring> => {
  const native = await import('@napi-rs/keyring') as NativeKeyringModule;
  const entry = (service: string, account: string): NativeEntry => new native.Entry(service, account);
  return {
    get(service, account) {
      try {
        return entry(service, account).getPassword();
      } catch (error) {
        if (error instanceof Error && /no entry|not found/i.test(error.message)) return null;
        throw error;
      }
    },
    set(service, account, secret) {
      entry(service, account).setPassword(secret);
    },
    delete(service, account) {
      try {
        entry(service, account).deletePassword();
        return true;
      } catch (error) {
        if (error instanceof Error && /no entry|not found/i.test(error.message)) return false;
        throw error;
      }
    },
  };
};

export const loadCredentialKeyring = async (): Promise<CredentialKeyring> => {
  if (process.env.HARNESS_DISABLE_KEYRING === '1') return createUnavailableCredentialKeyring();
  try {
    return await createNativeCredentialKeyring();
  } catch {
    return createUnavailableCredentialKeyring();
  }
};
