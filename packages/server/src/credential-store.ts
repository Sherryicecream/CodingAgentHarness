export const CREDENTIAL_SERVICE = 'CodingAgentHarness';
export const DEEPSEEK_ACCOUNT = 'deepseek-api-key';

export interface CredentialKeyring {
  get(service: string, account: string): string | null;
  set(service: string, account: string, secret: string): void;
  delete(service: string, account: string): boolean;
}

export interface CredentialStatus {
  readonly storage: 'keyring' | 'unavailable';
  readonly hasKey: boolean;
}

export interface CredentialStore {
  status(): CredentialStatus;
  getKey(): string | null;
  setKey(key: string): void;
  deleteKey(): boolean;
}

export interface CredentialStoreOptions {
  readonly keyring: CredentialKeyring;
}

const unavailableStatus = (): CredentialStatus => ({
  storage: 'unavailable',
  hasKey: false,
});

export const createCredentialStore = ({ keyring }: CredentialStoreOptions): CredentialStore => ({
  status() {
    try {
      const key = keyring.get(CREDENTIAL_SERVICE, DEEPSEEK_ACCOUNT);
      return { storage: 'keyring', hasKey: key !== null };
    } catch {
      return unavailableStatus();
    }
  },

  getKey() {
    try {
      return keyring.get(CREDENTIAL_SERVICE, DEEPSEEK_ACCOUNT);
    } catch {
      return null;
    }
  },

  setKey(key) {
    return keyring.set(CREDENTIAL_SERVICE, DEEPSEEK_ACCOUNT, key);
  },

  deleteKey() {
    return keyring.delete(CREDENTIAL_SERVICE, DEEPSEEK_ACCOUNT);
  },
});
