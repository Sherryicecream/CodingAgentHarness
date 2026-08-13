import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentContext } from '@harness/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCredentialStore,
  type CredentialStore,
} from '../src/credential-store.js';
import { createConfiguredProviderAdapter } from '../src/provider-execution.js';
import { addProvider } from '../src/provider-configuration.js';
import {
  LOCAL_RUNTIME_POLICY,
  PUBLIC_RUNTIME_POLICY,
} from '../src/security/runtime-policy.js';

const MASTER_PASSWORD = 'correct horse battery staple';
const API_KEY = 'configured-provider-secret-sentinel';
const temporaryDirectories: string[] = [];

const context: AgentContext = {
  messages: [{ role: 'user', content: 'Hello configured provider' }],
  tools: [],
  memory: [],
  config: {
    maxIterations: 1,
    testCommand: '',
    allowedTools: [],
    blockedCommands: [],
    ignoredPaths: [],
  },
  feedbackState: null,
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('configured provider execution', () => {
  it('selects an allowlisted encrypted provider and constructs an opaque adapter request', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'harness-provider-execution-'));
    const filePath = join(directory, 'credentials.enc');
    temporaryDirectories.push(directory);
    const credentialStore = createCredentialStore({ filePath });
    credentialStore.initialize(MASTER_PASSWORD);
    addProvider(credentialStore, {
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: API_KEY,
    });
    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    let authorizationAtExecution = '';
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      authorizationAtExecution = (init?.headers as Record<string, string>).Authorization;
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'configured response' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const resource = createConfiguredProviderAdapter({
      policy: LOCAL_RUNTIME_POLICY,
      credentialStore,
      fetchImpl,
    }, 'deepseek');
    const response = await resource.adapter.sendMessage(context);

    expect(response).toEqual({ content: 'configured response', toolCalls: [] });
    expect(requestUrl).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(requestInit).toMatchObject({ method: 'POST' });
    expect(authorizationAtExecution).toBe(`Bearer ${API_KEY}`);
    expect(requestInit?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: '',
    });
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Hello configured provider' }],
    });
    expect(JSON.stringify(resource)).not.toContain(API_KEY);
    expect(readFileSync(filePath, 'utf8')).not.toContain(API_KEY);

    resource.release();

    expect(() => resource.adapter.sendMessage(context)).toThrow(
      'Configured provider adapter is no longer available',
    );
  });

  it('does not execute configured provider URLs outside the built-in allowlist', () => {
    const directory = mkdtempSync(join(tmpdir(), 'harness-provider-execution-'));
    const filePath = join(directory, 'credentials.enc');
    temporaryDirectories.push(directory);
    const credentialStore = createCredentialStore({ filePath });
    credentialStore.initialize(MASTER_PASSWORD);
    addProvider(credentialStore, {
      id: 'deepseek',
      name: 'Untrusted endpoint',
      baseUrl: 'https://attacker.invalid',
      model: 'deepseek-chat',
      apiKey: API_KEY,
    });
    const fetchImpl = vi.fn<typeof fetch>();

    expect(() => createConfiguredProviderAdapter({
      policy: LOCAL_RUNTIME_POLICY,
      credentialStore,
      fetchImpl,
    }, 'deepseek')).toThrow('PROVIDER_ENDPOINT_NOT_ALLOWED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not execute configured provider IDs outside the built-in allowlist', () => {
    const directory = mkdtempSync(join(tmpdir(), 'harness-provider-execution-'));
    const filePath = join(directory, 'credentials.enc');
    temporaryDirectories.push(directory);
    const credentialStore = createCredentialStore({ filePath });
    credentialStore.initialize(MASTER_PASSWORD);
    addProvider(credentialStore, {
      id: 'fake-compatible',
      name: 'Untrusted provider',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: API_KEY,
    });
    const fetchImpl = vi.fn<typeof fetch>();

    expect(() => createConfiguredProviderAdapter({
      policy: LOCAL_RUNTIME_POLICY,
      credentialStore,
      fetchImpl,
    }, 'fake-compatible')).toThrow('PROVIDER_NOT_ALLOWED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps configured provider execution disabled in public mode', () => {
    const getKey = vi.fn(() => null);
    const credentialStore = { getKey } as unknown as CredentialStore;
    const fetchImpl = vi.fn<typeof fetch>();

    expect(() => createConfiguredProviderAdapter({
      policy: PUBLIC_RUNTIME_POLICY,
      credentialStore,
      fetchImpl,
    }, 'deepseek')).toThrow('PROVIDER_EXECUTION_DISABLED');
    expect(getKey).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
