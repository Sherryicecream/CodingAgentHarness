import { describe, expect, it, vi } from 'vitest';
import type { AgentRunInput, AgentRunOutput } from '../../src/agent/agent-run-types.js';
import {
  createDefaultAgentRun,
  type PrivilegedAgentRunLoader,
} from '../../src/agent/default-agent-run.js';
import type { CredentialStore } from '../../src/credential-store.js';
import { PUBLIC_RUNTIME_POLICY } from '../../src/security/runtime-policy.js';

const emptyCredentialStore: CredentialStore = {
  getState: () => 'empty',
  unlock: () => false,
  lock: () => undefined,
  initialize: () => undefined,
  hasKey: () => false,
  getKey: () => null,
  setKey: () => undefined,
  deleteKey: () => undefined,
  listServices: () => [],
};

const input: AgentRunInput = {
  session: {
    id: 'lazy-session',
    clientKey: 'client',
    workspace: 'server-owned-workspace',
    retention: 'temporary',
    status: 'running',
    createdAt: new Date('2026-08-08T00:00:00.000Z'),
    expiresAt: new Date('2026-08-08T01:00:00.000Z'),
  },
  task: 'use the supplied key',
  mode: 'byok',
  apiKey: 'test-key',
  emit: () => undefined,
};

describe('default agent run lazy privileged boundary', () => {
  it('cancels during a pending import without constructing or starting the privileged run', async () => {
    let resolveLoader!: (module: Awaited<ReturnType<PrivilegedAgentRunLoader>>) => void;
    const createPrivilegedAgentRun = vi.fn();
    const loader: PrivilegedAgentRunLoader = () => new Promise((resolve) => {
      resolveLoader = resolve;
    });
    const run = createDefaultAgentRun({
      policy: PUBLIC_RUNTIME_POLICY,
      credentialStore: emptyCredentialStore,
      privilegedLoader: loader,
    });
    const started = run(input);
    const handle = 'completion' in started ? started : { completion: started };
    const completion = handle.completion.catch((error: unknown) => error);

    const abort = handle.abort?.();
    resolveLoader({ createPrivilegedAgentRun });
    await abort;

    expect(createPrivilegedAgentRun).not.toHaveBeenCalled();
    await expect(completion).resolves.toMatchObject({
      name: 'AgentRunCancelledBeforeLoadError',
      message: 'AGENT_RUN_CANCELLED_BEFORE_LOAD',
    });
  });

  it('preserves the request and forwards queued approval and continuation after import', async () => {
    let resolveLoader!: (module: Awaited<ReturnType<PrivilegedAgentRunLoader>>) => void;
    const approve = vi.fn();
    const continuationResult: AgentRunOutput = { status: 'completed', sessionId: 'lazy-session' };
    const continueAfterApproval = vi.fn(async () => continuationResult);
    const innerRun = vi.fn(() => ({
      completion: Promise.resolve<AgentRunOutput>({ status: 'blocked' }),
      approve,
      continueAfterApproval,
    }));
    const createPrivilegedAgentRun = vi.fn(() => innerRun);
    const loader: PrivilegedAgentRunLoader = () => new Promise((resolve) => {
      resolveLoader = resolve;
    });
    const run = createDefaultAgentRun({
      policy: PUBLIC_RUNTIME_POLICY,
      credentialStore: emptyCredentialStore,
      privilegedLoader: loader,
    });
    const started = run(input);
    const handle = 'completion' in started ? started : { completion: started };

    handle.approve?.(true);
    const continued = handle.continueAfterApproval?.();
    resolveLoader({ createPrivilegedAgentRun });

    await expect(handle.completion).resolves.toEqual({ status: 'blocked' });
    await expect(continued).resolves.toEqual(continuationResult);
    expect(innerRun).toHaveBeenCalledWith(input);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledWith(true);
    expect(continueAfterApproval).toHaveBeenCalledTimes(1);
  });

  it('forwards an explicitly selected provider to the privileged run', async () => {
    let resolveLoader!: (module: Awaited<ReturnType<PrivilegedAgentRunLoader>>) => void;
    const innerRun = vi.fn(() => ({ completion: Promise.resolve<AgentRunOutput>({ status: 'completed' }) }));
    const createPrivilegedAgentRun = vi.fn(() => innerRun);
    const loader: PrivilegedAgentRunLoader = () => new Promise((resolve) => { resolveLoader = resolve; });
    const run = createDefaultAgentRun({ policy: PUBLIC_RUNTIME_POLICY, credentialStore: emptyCredentialStore, privilegedLoader: loader });
    const started = run({ ...input, mode: 'server', providerId: 'deepseek' });
    resolveLoader({ createPrivilegedAgentRun });
    await ('completion' in started ? started.completion : started);
    expect(innerRun).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'deepseek' }));
  });
});
