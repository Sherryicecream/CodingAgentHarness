import {
  DeepSeekAdapter,
  MockLLMAdapter,
  createAgentLoop,
  createContextBuilder,
  createMemoryStore,
  createFailureClassifier,
  createFeedbackLoop,
  createFixSuggestionBuilder,
  createGovernanceService,
  createResultParser,
  createStopCondition,
  createTestRunner,
  type AgentLoop,
  type LLMAdapter,
  type MemoryStore,
} from '@harness/core';
import { join } from 'node:path';
import type {
  AgentRun,
  AgentRunOutput,
  ByokAdapterFactory,
  ByokAdapterResource,
} from './agent-run-types.js';
import { createPolicyToolRegistry } from './tool-registry-factory.js';
import type { CredentialStore } from '../credential-store.js';
import { sanitizeSessionSecrets } from '../security/secret-redactor.js';
import type { RuntimePolicy } from '../security/runtime-policy.js';
import type { SSEEvent } from '../sse/sse-manager.js';
import { createConfiguredProviderAdapter } from '../provider-execution.js';

export interface PrivilegedAgentRunOptions {
  readonly policy: RuntimePolicy;
  readonly credentialStore: CredentialStore;
  readonly byokAdapterFactory?: ByokAdapterFactory;
  readonly configuredProviderFactory?: typeof createConfiguredProviderAdapter;
}

const safeProviderStatus = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  try {
    const status = Reflect.get(error, 'statusCode');
    return Number.isInteger(status) && status >= 400 && status <= 599
      ? status as number
      : undefined;
  } catch {
    return undefined;
  }
};

class LLMProviderError extends Error {
  constructor(readonly statusCode?: number) {
    super('LLM_PROVIDER_ERROR');
    this.name = 'LLMProviderError';
  }
}

const createProjectMemoryStore = (workspace: string): MemoryStore => {
  const store = createMemoryStore(join(workspace, '.harness-memories.db'));
  return {
    add: async (entry) => (await store).add(entry),
    search: async (projectPath, query, options) => (await store).search(projectPath, query, options),
    list: async (projectPath) => (await store).list(projectPath),
    delete: async (projectPath, id) => (await store).delete(projectPath, id),
    getByType: async (projectPath, type) => (await store).getByType(projectPath, type),
  };
};

const createTransientDeepSeekResource: ByokAdapterFactory = (apiKey) => {
  let adapter: DeepSeekAdapter | undefined = new DeepSeekAdapter({
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  });
  return {
    adapter: {
      sendMessage: (context, signal) => {
        const activeAdapter = adapter;
        if (!activeAdapter) throw new Error('BYOK adapter is no longer available');
        return activeAdapter.sendMessage(context, signal);
      },
    },
    release: () => {
      adapter?.dispose();
      adapter = undefined;
    },
  };
};

export const createPrivilegedAgentRun = (
  options: PrivilegedAgentRunOptions,
): AgentRun => ({ session, task, mode, emit, apiKey, providerId }) => {
  const tools = createPolicyToolRegistry(options.policy, session.workspace);
  const governance = createGovernanceService();
  const feedback = createFeedbackLoop(
    createTestRunner(),
    createResultParser(),
    createFailureClassifier(),
    createFixSuggestionBuilder(),
  );
  let byokSecret = mode === 'byok' ? apiKey ?? '' : '';
  apiKey = undefined;
  let byokResource: ByokAdapterResource | undefined;
  let llm: LLMAdapter | undefined;
  if (mode === 'byok') {
    if (byokSecret.length === 0) throw new Error('BYOK requires a credential');
    byokResource = (options.byokAdapterFactory ?? createTransientDeepSeekResource)(byokSecret);
    llm = byokResource.adapter;
  } else {
    if (mode === 'server' && providerId) {
      const resource = (options.configuredProviderFactory ?? createConfiguredProviderAdapter)({
        mode: options.policy.mode,
        credentialStore: options.credentialStore,
        policy: options.policy,
      }, providerId);
      byokResource = resource;
      llm = resource.adapter;
    }
    if (llm) {
      // configured provider selected
    } else {
    let serverApiKey = '';
    if (mode === 'server' && options.policy.allowServerCredentials) {
      serverApiKey = options.credentialStore.getKey('harness/deepseek-api-key') || '';
    }
    llm = serverApiKey
      ? new DeepSeekAdapter({
          apiKey: serverApiKey,
          baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
        })
      : new MockLLMAdapter([
        {
          content: 'I will inspect the isolated workspace.',
          toolCalls: [{
            id: 'call_1',
            name: 'search_code',
            arguments: { query: task, filePattern: '**/*' },
          }],
        },
        { content: 'Task completed.', toolCalls: [] },
      ]);
    serverApiKey = '';
    }
  }
  let loop: AgentLoop | undefined = createAgentLoop({
    llm,
    tools,
    governance,
    feedback,
    contextBuilder: createContextBuilder(),
    stopCondition: createStopCondition(),
    memoryStore: createProjectMemoryStore(session.workspace),
    config: { maxIterations: 10 },
    onEvent: (type, data) => emit(type as SSEEvent['type'], data),
  });
  llm = undefined;
  const mapResult = (completion: ReturnType<AgentLoop['run']>): Promise<AgentRunOutput> => (
    completion.then((result) => {
      const safeSession = mode === 'byok'
        ? sanitizeSessionSecrets(result.session, [byokSecret])
        : result.session;
      return {
        status: result.status,
        sessionId: safeSession.id,
        session: safeSession,
      };
    }, (error: unknown) => {
      if (mode === 'byok') throw new LLMProviderError(safeProviderStatus(error));
      throw error;
    })
  );
  let activeCompletion = mapResult(loop.run(task, session.workspace));
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    try {
      byokResource?.release?.();
    } finally {
      byokResource = undefined;
      byokSecret = '';
      loop = undefined;
    }
  };
  return {
    completion: activeCompletion,
    continueAfterApproval: () => {
      if (!loop) throw new Error('Agent run is no longer active');
      activeCompletion = mapResult(loop.continueAfterApproval(true));
      return activeCompletion;
    },
    approve: (approved) => loop?.handleApproval(approved),
    abort: () => { loop?.abort(); },
    release,
  };
};
