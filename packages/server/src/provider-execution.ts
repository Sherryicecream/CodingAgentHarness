import { DeepSeekAdapter, type LLMAdapter } from '@harness/core';
import type { CredentialStore } from './credential-store.js';
import {
  isValidProviderId,
  parseProviderInput,
  type ProviderInput,
} from './provider-configuration.js';
import type { RuntimePolicy } from './security/runtime-policy.js';

const PROVIDER_SERVICE_PREFIX = 'harness/provider/';
const ALLOWED_PROVIDER_BASE_URLS: ReadonlyMap<string, string> = new Map([
  ['deepseek', 'https://api.deepseek.com'],
] as const);

export interface ConfiguredProviderAdapterDependencies {
  readonly policy: RuntimePolicy;
  readonly credentialStore: CredentialStore;
  readonly fetchImpl?: typeof fetch;
}

export interface ConfiguredProviderAdapterResource {
  readonly adapter: LLMAdapter;
  release(): void;
}

export const createConfiguredProviderAdapter = (
  dependencies: ConfiguredProviderAdapterDependencies,
  providerId: string,
): ConfiguredProviderAdapterResource => {
  if (dependencies.policy.mode !== 'local' || !dependencies.policy.allowServerCredentials) {
    throw new Error('PROVIDER_EXECUTION_DISABLED');
  }
  if (!isValidProviderId(providerId)) {
    throw new Error('PROVIDER_NOT_ALLOWED');
  }
  const allowedBaseUrl = ALLOWED_PROVIDER_BASE_URLS.get(providerId);
  if (!allowedBaseUrl) throw new Error('PROVIDER_NOT_ALLOWED');

  let serializedRecord = dependencies.credentialStore.getKey(
    `${PROVIDER_SERVICE_PREFIX}${providerId}`,
  ) ?? '';
  let configuredProvider: ProviderInput | null;
  try {
    configuredProvider = parseProviderInput(JSON.parse(serializedRecord));
  } catch {
    configuredProvider = null;
  } finally {
    serializedRecord = '';
  }
  if (!configuredProvider || configuredProvider.id !== providerId) {
    throw new Error('PROVIDER_NOT_CONFIGURED');
  }
  if (configuredProvider.baseUrl !== allowedBaseUrl) {
    throw new Error('PROVIDER_ENDPOINT_NOT_ALLOWED');
  }

  let implementation: DeepSeekAdapter | undefined = new DeepSeekAdapter({
    apiKey: configuredProvider.apiKey,
    model: configuredProvider.model,
    baseUrl: configuredProvider.baseUrl,
    fetchImpl: dependencies.fetchImpl,
  });
  configuredProvider = null;

  return {
    adapter: {
      sendMessage: (context, signal) => {
        if (!implementation) {
          throw new Error('Configured provider adapter is no longer available');
        }
        return implementation.sendMessage(context, signal);
      },
    },
    release: () => {
      implementation?.dispose();
      implementation = undefined;
    },
  };
};
