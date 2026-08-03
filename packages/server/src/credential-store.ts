import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HARNESS_DIR = join(homedir(), '.harness');
const CREDENTIALS_FILE = join(HARNESS_DIR, 'credentials.enc');
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT = 'harness-credential-store-v1';

/**
 * Derive a 256-bit key from a machine-specific seed.
 * Uses the machine's hostname + OS user as the seed, so the key is
 * bound to the machine and user account (defense in depth).
 */
function deriveKey(): Buffer {
  const seed = `${process.env.COMPUTERNAME || process.env.HOSTNAME || 'unknown'}:${process.env.USERNAME || process.env.USER || 'unknown'}`;
  return scryptSync(seed, SALT, KEY_LENGTH);
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns: base64(iv + ciphertext + authTag)
 */
function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, authTag]).toString('base64');
}

/**
 * Decrypt a base64-encoded AES-256-GCM ciphertext.
 * Expected format: base64(iv(16) + ciphertext(N) + authTag(16))
 */
function decrypt(ciphertext: string): string {
  const key = deriveKey();
  const raw = Buffer.from(ciphertext, 'base64');
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(raw.length - TAG_LENGTH);
  const data = raw.subarray(IV_LENGTH, raw.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(data) + decipher.final('utf8');
}

export interface CredentialStore {
  /** Check if a key is configured */
  hasKey(service: string): boolean;
  /** Get a stored key (returns null if not configured) */
  getKey(service: string): string | null;
  /** Store a key */
  setKey(service: string, key: string): void;
  /** Delete a stored key */
  deleteKey(service: string): void;
  /** List all services that have keys stored */
  listServices(): string[];
}

/**
 * Create an encrypted file-based credential store.
 *
 * Credentials are stored in ~/.harness/credentials.enc as an encrypted JSON object.
 * The encryption key is derived from the machine's hostname + OS user,
 * providing machine-binding without requiring a master password.
 *
 * For production/deployment, use the DEEPSEEK_API_KEY environment variable instead.
 */
export function createCredentialStore(): CredentialStore {
  // Ensure the harness directory exists
  if (!existsSync(HARNESS_DIR)) {
    mkdirSync(HARNESS_DIR, { recursive: true });
  }

  function readStore(): Record<string, string> {
    if (!existsSync(CREDENTIALS_FILE)) {
      return {};
    }
    try {
      const raw = readFileSync(CREDENTIALS_FILE, 'utf-8').trim();
      if (!raw) return {};
      const decrypted = decrypt(raw);
      return JSON.parse(decrypted);
    } catch {
      // If decryption fails (e.g., machine changed), treat as empty
      return {};
    }
  }

  function writeStore(data: Record<string, string>): void {
    const plaintext = JSON.stringify(data);
    const encrypted = encrypt(plaintext);
    writeFileSync(CREDENTIALS_FILE, encrypted, 'utf-8');
  }

  return {
    hasKey(service: string): boolean {
      return !!process.env[serviceToEnvVar(service)] || (service in readStore());
    },

    getKey(service: string): string | null {
      // Environment variable takes precedence (for production deployment)
      const envVar = process.env[serviceToEnvVar(service)];
      if (envVar) return envVar;
      const store = readStore();
      return store[service] ?? null;
    },

    setKey(service: string, key: string): void {
      const store = readStore();
      store[service] = key;
      writeStore(store);
    },

    deleteKey(service: string): void {
      const store = readStore();
      delete store[service];
      writeStore(store);
    },

    listServices(): string[] {
      return Object.keys(readStore());
    },
  };
}

/**
 * Convert a service name to an environment variable name.
 * E.g., "harness/deepseek-api-key" → "DEEPSEEK_API_KEY"
 */
function serviceToEnvVar(service: string): string {
  return service
    .replace(/^harness\//, '')
    .replace(/-/g, '_')
    .toUpperCase();
}