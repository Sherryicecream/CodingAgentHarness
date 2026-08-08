import { isIP } from 'node:net';
import { join } from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import { createSessionStore, type SessionStore } from '@harness/core';
import { createCredentialStore, type CredentialStore } from './credential-store.js';
import {
  createAgentRouter,
  createDefaultAgentRun,
  type AgentRun,
  type RunRateLimitOptions,
} from './routes/agent.js';
import { createConfigRouter } from './routes/config.js';
import { createSessionRouter } from './routes/session.js';
import {
  resolveRuntimePolicy,
  type RuntimeMode,
} from './security/runtime-policy.js';
import { createSessionRegistry } from './session/session-registry.js';
import type { SessionRegistry } from './session/session-registry.js';
import { createWorkspaceManager } from './session/workspace-manager.js';
import { createSSEManager } from './sse/sse-manager.js';
import type { SSEManager } from './sse/sse-manager.js';

export type AppMode = RuntimeMode;
export type TrustProxyConfiguration = 1 | readonly string[];

export interface IntervalHandle {
  unref?(): void;
}

export interface IntervalScheduler {
  setInterval(callback: () => void | Promise<void>, delayMs: number): IntervalHandle;
  clearInterval(handle: IntervalHandle): void;
}

export type HarnessApp = Express & {
  close(): void;
  sweepSessions(): Promise<void>;
};

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
  sessionRateLimit?: RunRateLimitOptions;
  trustProxy?: TrustProxyConfiguration;
  sessionRegistry?: SessionRegistry;
  sweepIntervalMs?: number;
  intervalScheduler?: IntervalScheduler;
  sseManager?: SSEManager;
  sessionStore?: SessionStore;
}

const disabledCredentialStore = (): CredentialStore => ({
  hasKey: () => { throw new Error('Credential store is disabled by runtime policy'); },
  getKey: () => { throw new Error('Credential store is disabled by runtime policy'); },
  setKey: () => { throw new Error('Credential store is disabled by runtime policy'); },
  deleteKey: () => { throw new Error('Credential store is disabled by runtime policy'); },
  listServices: () => { throw new Error('Credential store is disabled by runtime policy'); },
});

const MAX_TIMER_MS = 2_147_483_647;

const positiveIntegerFromEnvironment = (
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number | undefined => {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : undefined;
};

const TRUST_PROXY_PRESETS = new Set(['loopback', 'linklocal', 'uniquelocal']);

const isRestrictedProxyAddress = (value: string): boolean => {
  if (TRUST_PROXY_PRESETS.has(value)) {
    return true;
  }
  const [address, prefix, ...extra] = value.split('/');
  const version = isIP(address ?? '');
  if (extra.length > 0 || version === 0) {
    return false;
  }
  if (prefix === undefined) {
    return true;
  }
  const bits = Number(prefix);
  return Number.isInteger(bits) && bits > 0 && bits <= (version === 4 ? 32 : 128);
};

const resolveTrustProxy = (
  configured: unknown,
  environmentValue: string | undefined,
): false | 1 | string[] => {
  const value = configured ?? environmentValue;
  if (value === undefined || value === '' || value === 'false') {
    return false;
  }
  if (value === 1 || value === '1') {
    return 1;
  }
  const allowlist = Array.isArray(value)
    ? value
    : typeof value === 'string' ? value.split(',').map((entry) => entry.trim()) : [];
  if (
    allowlist.length === 0
    || allowlist.some((entry) => typeof entry !== 'string' || !isRestrictedProxyAddress(entry))
  ) {
    throw new Error('Invalid trust proxy configuration; use one hop or an IP/CIDR allowlist');
  }
  return [...allowlist];
};

const defaultIntervalScheduler: IntervalScheduler = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

const DEFAULT_SESSION_SWEEP_INTERVAL_MS = 60_000;

export const createApp = (options: AppOptions = {}): HarnessApp => {
  const app = express() as HarnessApp;
  const policy = resolveRuntimePolicy(options.mode ?? process.env.HARNESS_MODE);
  const trustProxy = resolveTrustProxy(options.trustProxy, process.env.HARNESS_TRUST_PROXY);
  const workspaceRoot = options.workspaceRoot
    ?? process.env.HARNESS_WORKSPACE_ROOT
    ?? join(process.cwd(), '.harness-workspaces');
  const credentialStore = options.credentialStore
    ?? (policy.allowServerCredentials ? createCredentialStore() : disabledCredentialStore());
  const sessionStore = policy.mode === 'local'
    ? options.sessionStore ?? createSessionStore('.harness-sessions')
    : undefined;
  const sessionRegistry = options.sessionRegistry ?? createSessionRegistry({
    workspaceManager: createWorkspaceManager({ root: workspaceRoot }),
    now: options.now,
    idGenerator: options.idGenerator,
    maxConcurrent: options.maxConcurrent
      ?? positiveIntegerFromEnvironment('HARNESS_MAX_CONCURRENT_RUNS'),
  });
  const sseManager = options.sseManager ?? createSSEManager();
  const intervalScheduler = options.intervalScheduler ?? defaultIntervalScheduler;
  const sweepIntervalMs = options.sweepIntervalMs
    ?? positiveIntegerFromEnvironment('HARNESS_SESSION_SWEEP_INTERVAL_MS', MAX_TIMER_MS)
    ?? DEFAULT_SESSION_SWEEP_INTERVAL_MS;
  const logger = options.logger ?? console;
  const sweepSessions = async (): Promise<void> => {
    try {
      await sessionRegistry.sweepExpired();
    } catch {
      logger.warn('SESSION_SWEEP_FAILED');
    }
  };
  const sweepTimer = intervalScheduler.setInterval(sweepSessions, sweepIntervalMs);
  sweepTimer.unref?.();
  app.sweepSessions = sweepSessions;
  app.close = () => intervalScheduler.clearInterval(sweepTimer);

  app.disable('x-powered-by');
  if (trustProxy !== false) {
    app.set('trust proxy', trustProxy);
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
        ?? positiveIntegerFromEnvironment('HARNESS_RUN_RATE_WINDOW_MS', MAX_TIMER_MS),
    },
    sessionRateLimit: {
      limit: options.sessionRateLimit?.limit
        ?? positiveIntegerFromEnvironment('HARNESS_SESSION_RATE_LIMIT'),
      windowMs: options.sessionRateLimit?.windowMs
        ?? positiveIntegerFromEnvironment('HARNESS_SESSION_RATE_WINDOW_MS', MAX_TIMER_MS),
    },
    logger,
    sessionStore,
  }));
  if (sessionStore) {
    app.use('/api/sessions', createSessionRouter(sessionStore));
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
