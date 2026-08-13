import type { CredentialStore } from './credential-store.js';

const PROVIDER_SERVICE_PREFIX = 'harness/provider/';
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

interface StoredProviderRecord {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
}

export interface ProviderSummary {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly hasApiKey: true;
}

export interface ProviderInput {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
}

const isBoundedText = (value: unknown, maximumLength: number): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= maximumLength
  && value === value.trim()
  && !CONTROL_CHARACTER_PATTERN.test(value)
);

const isSafeBaseUrl = (value: unknown): value is string => {
  if (!isBoundedText(value, 2_048)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.hostname.length > 0
      && parsed.username === ''
      && parsed.password === ''
      && parsed.search === ''
      && parsed.hash === '';
  } catch {
    return false;
  }
};

export const parseProviderInput = (value: unknown): ProviderInput | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<ProviderInput>;
  if (
    typeof candidate.id !== 'string'
    || candidate.id !== 'deepseek'
    || !PROVIDER_ID_PATTERN.test(candidate.id)
    || !isBoundedText(candidate.name, 80)
    || !isSafeBaseUrl(candidate.baseUrl)
    || !isBoundedText(candidate.model, 200)
    || !isBoundedText(candidate.apiKey, 8_192)
  ) {
    return null;
  }
  return {
    id: candidate.id,
    name: candidate.name,
    baseUrl: candidate.baseUrl,
    model: candidate.model,
    apiKey: candidate.apiKey,
  };
};

const serviceName = (id: string): string => `${PROVIDER_SERVICE_PREFIX}${id}`;

const toSummary = (record: StoredProviderRecord): ProviderSummary => ({
  id: record.id,
  name: record.name,
  baseUrl: record.baseUrl,
  model: record.model,
  hasApiKey: true,
});

const parseStoredProvider = (raw: string | null): StoredProviderRecord | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredProviderRecord>;
    const input = parseProviderInput(parsed);
    if (parsed.version !== 1 || !input) return null;
    return { version: 1, ...input };
  } catch {
    return null;
  }
};

export const listProviders = (credentialStore: CredentialStore): ProviderSummary[] => {
  const entries = credentialStore.getKeys?.(PROVIDER_SERVICE_PREFIX)
    ?? Object.fromEntries(
      credentialStore.listServices()
        .filter((service) => service.startsWith(PROVIDER_SERVICE_PREFIX))
        .map((service) => [service, credentialStore.getKey(service) ?? '']),
    );
  return Object.values(entries)
    .map(parseStoredProvider)
    .filter((provider): provider is StoredProviderRecord => provider !== null)
    .map(toSummary)
    .sort((left, right) => left.id.localeCompare(right.id));
};

export const hasProvider = (credentialStore: CredentialStore, id: string): boolean => (
  credentialStore.listServices().includes(serviceName(id))
);

export const addProvider = (credentialStore: CredentialStore, input: ProviderInput): ProviderSummary => {
  const record: StoredProviderRecord = { version: 1, ...input };
  credentialStore.setKey(serviceName(input.id), JSON.stringify(record));
  return toSummary(record);
};

export const deleteProvider = (credentialStore: CredentialStore, id: string): void => {
  credentialStore.deleteKey(serviceName(id));
};

export const isValidProviderId = (id: unknown): id is string => (
  typeof id === 'string' && PROVIDER_ID_PATTERN.test(id)
);
