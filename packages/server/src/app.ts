import { join } from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import { createCredentialStore, type CredentialStore } from './credential-store.js';
import {
  createAgentRouter,
  createDefaultAgentRun,
  type AgentRun,
  type RunRateLimitOptions,
} from './routes/agent.js';
import { createConfigRouter } from './routes/config.js';
import { sessionRouter } from './routes/session.js';
import {
  resolveRuntimePolicy,
  type RuntimeMode,
} from './security/runtime-policy.js';
import { createSessionRegistry } from './session/session-registry.js';
import { createWorkspaceManager } from './session/workspace-manager.js';
import { createSSEManager } from './sse/sse-manager.js';

export type AppMode = RuntimeMode;

export interface AppOptions {
  mode?: AppMode;
  workspaceRoot?: string;
  now?: () => Date;
  idGenerator?: () => string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, 'error' | 'info' | 'warn'>;
  credentialStore?: CredentialStore;
  agentRun?: AgentRun;
  maxConcurrent?: number;
  runRateLimit?: RunRateLimitOptions;
  trustProxy?: boolean | number | string;
}

const disabledCredentialStore = (): CredentialStore => ({
  hasKey: () => { throw new Error('Credential store is disabled by runtime policy'); },
  getKey: () => { throw new Error('Credential store is disabled by runtime policy'); },
  setKey: () => { throw new Error('Credential store is disabled by runtime policy'); },
  deleteKey: () => { throw new Error('Credential store is disabled by runtime policy'); },
  listServices: () => { throw new Error('Credential store is disabled by runtime policy'); },
});

const positiveIntegerFromEnvironment = (name: string): number | undefined => {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
};

export const createApp = (options: AppOptions = {}): Express => {
  const app = express();
  const policy = resolveRuntimePolicy(options.mode ?? process.env.HARNESS_MODE);
  const workspaceRoot = options.workspaceRoot
    ?? process.env.HARNESS_WORKSPACE_ROOT
    ?? join(process.cwd(), '.harness-workspaces');
  const credentialStore = options.credentialStore
    ?? (policy.allowServerCredentials ? createCredentialStore() : disabledCredentialStore());
  const sessionRegistry = createSessionRegistry({
    workspaceManager: createWorkspaceManager({ root: workspaceRoot }),
    now: options.now,
    idGenerator: options.idGenerator,
    maxConcurrent: options.maxConcurrent
      ?? positiveIntegerFromEnvironment('HARNESS_MAX_CONCURRENT_RUNS'),
  });
  const sseManager = createSSEManager();

  app.disable('x-powered-by');
  if (options.trustProxy !== undefined) {
    app.set('trust proxy', options.trustProxy);
  }
  app.use(cors({ origin: false }));
  app.use(express.json({ limit: '64kb' }));

  app.use('/api/agent', createAgentRouter({
    policy,
    sessionRegistry,
    sseManager,
    agentRun: options.agentRun ?? createDefaultAgentRun({ policy, credentialStore }),
    now: options.now,
    fetchImpl: options.fetchImpl,
    credentialStore,
    runRateLimit: {
      limit: options.runRateLimit?.limit
        ?? positiveIntegerFromEnvironment('HARNESS_RUN_RATE_LIMIT'),
      windowMs: options.runRateLimit?.windowMs
        ?? positiveIntegerFromEnvironment('HARNESS_RUN_RATE_WINDOW_MS'),
    },
  }));
  if (policy.mode === 'local') {
    app.use('/api/sessions', sessionRouter);
  }
  app.use('/api/config', createConfigRouter({ policy, credentialStore }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', mode: policy.mode }));

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static('dist/client'));
    app.get('*', (_req, res) => {
      res.sendFile('dist/client/index.html', { root: '.' });
    });
  }

  return app;
};
