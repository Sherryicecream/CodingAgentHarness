import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const HARNESS_DIR = join(homedir(), '.harness');
const CREDENTIALS_FILE = join(HARNESS_DIR, 'credentials.enc');
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const KDF = { name: 'scrypt', N: 32_768, r: 8, p: 1 } as const;
const VERIFIER = 'harness-credential-store-v2';

export type CredentialStoreState = 'empty' | 'legacy' | 'locked' | 'unlocked';

interface EncryptedValue {
  iv: string;
  ciphertext: string;
  tag: string;
}

interface CredentialEnvelope {
  version: 2;
  kdf: { name: 'scrypt'; salt: string; N: number; r: number; p: number };
  verifier: EncryptedValue;
  entries: Record<string, EncryptedValue>;
}

export interface CredentialStore {
  getState(): CredentialStoreState;
  unlock(masterPassword: string): boolean;
  lock(): void;
  initialize(masterPassword: string): void;
  hasKey(service: string): boolean;
  getKey(service: string): string | null;
  getKeys?(servicePrefix: string): Record<string, string>;
  setKey(service: string, key: string): void;
  deleteKey(service: string): void;
  listServices(): string[];
}

export interface CredentialStoreOptions {
  readonly filePath?: string;
}

const isValidPassword = (password: string): boolean => (
  password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH
);

const passwordError = (): Error => new Error('MASTER_PASSWORD_TOO_SHORT');

const deriveKey = (password: string, salt: Buffer, params = KDF): Buffer => scryptSync(
  password,
  salt,
  KEY_LENGTH,
  { N: params.N, r: params.r, p: params.p, maxmem: 64 * 1024 * 1024 },
);

const encrypt = (plaintext: string, key: Buffer): EncryptedValue => {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
};

const decrypt = (value: EncryptedValue, key: Buffer): string => {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return decipher.update(Buffer.from(value.ciphertext, 'base64')) + decipher.final('utf8');
};

const isEncryptedValue = (value: unknown): value is EncryptedValue => (
  !!value && typeof value === 'object'
  && typeof (value as EncryptedValue).iv === 'string'
  && typeof (value as EncryptedValue).ciphertext === 'string'
  && typeof (value as EncryptedValue).tag === 'string'
);

const parseEnvelope = (raw: string): CredentialEnvelope | null => {
  try {
    const parsed = JSON.parse(raw) as Partial<CredentialEnvelope>;
    if (parsed.version !== 2 || !parsed.kdf || parsed.kdf.name !== 'scrypt'
      || typeof parsed.kdf.salt !== 'string' || !isEncryptedValue(parsed.verifier)
      || !parsed.entries || typeof parsed.entries !== 'object') return null;
    for (const entry of Object.values(parsed.entries)) {
      if (!isEncryptedValue(entry)) return null;
    }
    return parsed as CredentialEnvelope;
  } catch {
    return null;
  }
};

const ensurePassword = (password: string): void => {
  if (!isValidPassword(password)) throw passwordError();
};

export function createCredentialStore(options: CredentialStoreOptions = {}): CredentialStore {
  const filePath = options.filePath ?? CREDENTIALS_FILE;
  const directory = dirname(filePath);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { chmodSync(directory, 0o700); } catch { /* Windows may not expose POSIX modes. */ }

  let derivedKey: Buffer | null = null;

  const readEnvelope = (): CredentialEnvelope | null => {
    if (!existsSync(filePath)) return null;
    try { return parseEnvelope(readFileSync(filePath, 'utf8').trim()); } catch { return null; }
  };

  const hasFile = (): boolean => existsSync(filePath);

  const writeEnvelope = (envelope: CredentialEnvelope): void => {
    const temporaryPath = `${filePath}.tmp-${randomBytes(8).toString('hex')}`;
    try {
      writeFileSync(temporaryPath, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600 });
      try { chmodSync(temporaryPath, 0o600); } catch { /* Windows may not expose POSIX modes. */ }
      renameSync(temporaryPath, filePath);
      try { chmodSync(filePath, 0o600); } catch { /* Windows may not expose POSIX modes. */ }
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    }
  };

  const requireUnlocked = (): Buffer => {
    if (!derivedKey) throw new Error('CREDENTIAL_STORE_LOCKED');
    return derivedKey;
  };

  const store: CredentialStore = {
    getState(): CredentialStoreState {
      if (derivedKey) return 'unlocked';
      if (!hasFile()) return 'empty';
      return readEnvelope() ? 'locked' : 'legacy';
    },

    initialize(masterPassword: string): void {
      ensurePassword(masterPassword);
      const salt = randomBytes(SALT_LENGTH);
      const key = deriveKey(masterPassword, salt);
      const envelope: CredentialEnvelope = {
        version: 2,
        kdf: { ...KDF, salt: salt.toString('base64') },
        verifier: encrypt(VERIFIER, key),
        entries: {},
      };
      writeEnvelope(envelope);
      derivedKey?.fill(0);
      derivedKey = key;
    },

    unlock(masterPassword: string): boolean {
      if (!isValidPassword(masterPassword)) return false;
      const envelope = readEnvelope();
      if (!envelope) return false;
      try {
        const salt = Buffer.from(envelope.kdf.salt, 'base64');
        const key = deriveKey(masterPassword, salt, envelope.kdf);
        if (decrypt(envelope.verifier, key) !== VERIFIER) {
          key.fill(0);
          return false;
        }
        derivedKey?.fill(0);
        derivedKey = key;
        return true;
      } catch {
        return false;
      }
    },

    lock(): void {
      derivedKey?.fill(0);
      derivedKey = null;
    },

    hasKey(service: string): boolean {
      return !!process.env[serviceToEnvVar(service)] || !!readEnvelope()?.entries[service];
    },

    getKey(service: string): string | null {
      const envVar = process.env[serviceToEnvVar(service)];
      if (envVar) return envVar;
      const envelope = readEnvelope();
      const entry = envelope?.entries[service];
      if (!entry || !derivedKey) return null;
      try { return decrypt(entry, derivedKey); } catch { return null; }
    },

    getKeys(servicePrefix: string): Record<string, string> {
      const envelope = readEnvelope();
      if (!envelope || !derivedKey) return {};
      const values: Record<string, string> = {};
      for (const [service, entry] of Object.entries(envelope.entries)) {
        if (!service.startsWith(servicePrefix)) continue;
        try { values[service] = decrypt(entry, derivedKey); } catch { /* Ignore corrupt entries. */ }
      }
      return values;
    },

    setKey(service: string, key: string): void {
      const encryptionKey = requireUnlocked();
      const envelope = readEnvelope();
      if (!envelope) throw new Error('CREDENTIAL_STORE_NOT_INITIALIZED');
      envelope.entries[service] = encrypt(key, encryptionKey);
      writeEnvelope(envelope);
    },

    deleteKey(service: string): void {
      requireUnlocked();
      const envelope = readEnvelope();
      if (!envelope) return;
      delete envelope.entries[service];
      if (Object.keys(envelope.entries).length === 0) {
        store.lock();
        if (existsSync(filePath)) unlinkSync(filePath);
        return;
      }
      writeEnvelope(envelope);
    },

    listServices(): string[] {
      return Object.keys(readEnvelope()?.entries ?? {});
    },
  };

  return store;
}

function serviceToEnvVar(service: string): string {
  return service.replace(/^harness\//, '').replace(/-/g, '_').toUpperCase();
}
