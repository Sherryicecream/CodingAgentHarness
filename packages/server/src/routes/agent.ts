import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { SessionStore } from '../../../core/src/loop/session-store.js';
import type { Session } from '../../../core/src/types.js';
import type {
  AgentRun,
  AgentRunHandle,
  AgentRunOutput,
} from '../agent/agent-run-types.js';
export { createDefaultAgentRun } from '../agent/default-agent-run.js';
export type {
  AgentRun,
  AgentRunHandle,
  AgentRunInput,
  AgentRunOutput,
  ByokAdapterFactory,
  ByokAdapterResource,
} from '../agent/agent-run-types.js';
import { isSecureByokRequest } from '../security/request-security.js';
import { sanitizeSessionSecrets } from '../security/secret-redactor.js';
import type { RuntimeExperience, RuntimePolicy } from '../security/runtime-policy.js';
import {
  ConcurrentSessionLimitError,
  DuplicateSessionStartError,
  SessionNotFoundError,
  type PublicSession,
  type SessionRegistry,
} from '../session/session-registry.js';
import type { SSEEvent, SSEManager } from '../sse/sse-manager.js';

const DEFAULT_RUN_RATE_WINDOW_MS = 60 * 60 * 1_000;
const DEFAULT_RUN_RATE_LIMIT = 20;
const DEFAULT_SESSION_RATE_LIMIT = 20;
const MAX_TASK_LENGTH = 1_000;
const RUN_FIELDS = new Set(['sessionId', 'task', 'mode', 'apiKey']);

export interface RunRateLimitOptions {
  readonly windowMs?: number;
  readonly limit?: number;
}

export interface AgentRouterDependencies {
  readonly policy: RuntimePolicy;
  readonly sessionRegistry: SessionRegistry;
  readonly sseManager: SSEManager;
  readonly agentRun: AgentRun;
  readonly now?: () => Date;
  readonly testKeyHandler?: (req: Request, res: Response) => Promise<void>;
  readonly runRateLimit?: RunRateLimitOptions;
  readonly sessionRateLimit?: RunRateLimitOptions;
  readonly logger?: Pick<Console, 'warn'>;
  readonly sessionStore?: SessionStore;
  readonly abortTimeoutMs?: number;
  readonly historySaveTimeoutMs?: number;
}

export interface ActiveExpiryResult {
  readonly protectedSessionIds: ReadonlySet<string>;
  readonly failureCount: number;
}

export type AgentRouter = Router & {
  expireActiveSessions(): Promise<ActiveExpiryResult>;
};

const normalizeClientKey = (req: Request): string => {
  const value = req.ip || req.socket.remoteAddress || 'unknown';
  return value.replace(/^::ffff:/i, '').toLowerCase();
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value)
);

interface ValidatedRunRequest {
  readonly sessionId: string;
  readonly task: string;
  readonly mode: RuntimeExperience;
  readonly apiKey?: string;
}

const validateRunRequest = (body: unknown): ValidatedRunRequest | null => {
  if (!isPlainObject(body) || Object.keys(body).some((key) => !RUN_FIELDS.has(key))) {
    return null;
  }
  const { sessionId, task, mode, apiKey } = body;
  if (
    typeof sessionId !== 'string'
    || sessionId.length === 0
    || typeof task !== 'string'
    || task.trim().length === 0
    || task.length > MAX_TASK_LENGTH
    || typeof mode !== 'string'
    || (apiKey !== undefined && typeof apiKey !== 'string')
    || (mode === 'byok' && (typeof apiKey !== 'string' || apiKey.length === 0))
    || (mode !== 'byok' && apiKey !== undefined)
  ) {
    return null;
  }
  return { sessionId, task, mode: mode as RuntimeExperience, apiKey };
};

const toRunHandle = (
  started: Promise<AgentRunOutput | void> | AgentRunHandle,
): AgentRunHandle => (
  'completion' in started ? started : { completion: started }
);

const safeProviderStatus = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  try {
    const status = Reflect.get(error, 'statusCode');
    return Number.isInteger(status) && status >= 400 && status <= 599
      ? status as number
      : undefined;
  } catch {
    return undefined;
  }
};

const DEFAULT_ABORT_TIMEOUT_MS = 5_000;
const DEFAULT_HISTORY_SAVE_TIMEOUT_MS = 5_000;

const abortWithTimeout = async (
  abort: () => void | Promise<void>,
  timeoutMs: number,
): Promise<'completed' | 'timed_out'> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timed_out'>((resolve) => {
    timer = setTimeout(() => resolve('timed_out'), timeoutMs);
    timer.unref?.();
  });
  const operation = Promise.resolve().then(abort).then(() => 'completed' as const);
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

export const createAgentRouter = (
  dependencies: AgentRouterDependencies,
): AgentRouter => {
  const router = Router() as AgentRouter;
  const now = dependencies.now ?? (() => new Date());
  const logger = dependencies.logger ?? console;
  const abortTimeoutMs = dependencies.abortTimeoutMs ?? DEFAULT_ABORT_TIMEOUT_MS;
  const historySaveTimeoutMs = dependencies.historySaveTimeoutMs
    ?? DEFAULT_HISTORY_SAVE_TIMEOUT_MS;
  if (!Number.isSafeInteger(abortTimeoutMs) || abortTimeoutMs <= 0) {
    throw new Error('abortTimeoutMs must be a positive integer');
  }
  if (!Number.isSafeInteger(historySaveTimeoutMs) || historySaveTimeoutMs <= 0) {
    throw new Error('historySaveTimeoutMs must be a positive integer');
  }
  type CompletionOutcome =
    | { readonly kind: 'resolved'; readonly result: AgentRunOutput | void }
    | { readonly kind: 'rejected'; readonly providerStatus?: number };
  interface ActiveRun {
    readonly session: PublicSession;
    readonly clientKey: string;
    handle?: AgentRunHandle;
    readonly mode: RuntimeExperience;
    phase: 'running' | 'blocked' | 'continuing' | 'terminating' | 'terminal';
    termination?: Promise<void>;
    pendingCompletionOutcome?: CompletionOutcome;
    providerStatus?: number;
  }
  const activeRuns = new Map<string, ActiveRun>();
  const emit = (sessionId: string, type: SSEEvent['type'], data: unknown): void => {
    dependencies.sseManager.push(sessionId, { type, data, timestamp: now() });
  };
  const scheduleHistorySave = (session: Session): void => {
    if (!dependencies.sessionStore) {
      return;
    }
    let snapshot: Session;
    try {
      snapshot = sanitizeSessionSecrets(session, []);
    } catch {
      logger.warn('SESSION_HISTORY_SNAPSHOT_FAILED');
      return;
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      logger.warn('SESSION_HISTORY_SAVE_TIMEOUT');
    }, historySaveTimeoutMs);
    timer.unref?.();
    void Promise.resolve()
      .then(() => dependencies.sessionStore!.save(snapshot))
      .then(() => {
        clearTimeout(timer);
      }, () => {
        clearTimeout(timer);
        if (!timedOut) {
          logger.warn('SESSION_HISTORY_SAVE_FAILED');
        }
      });
  };
  const cleanupRun = (active: ActiveRun): void => {
    if (activeRuns.get(active.session.id) === active) {
      activeRuns.delete(active.session.id);
    }
    try {
      active.handle?.release?.();
    } catch {
      logger.warn('SESSION_RESOURCE_RELEASE_FAILED');
    } finally {
      try {
        dependencies.sseManager.clearSecrets?.(active.session.id);
        dependencies.sseManager.close(active.session.id);
      } catch {
        logger.warn('SESSION_SSE_CLOSE_FAILED');
      }
    }
  };
  const finalizeRun = async (
    active: ActiveRun,
    requestedOutcome: 'completed' | 'failed',
    result?: AgentRunOutput | void,
  ): Promise<void> => {
    if (active.phase === 'terminal') {
      return;
    }
    active.phase = 'terminal';
    try {
      const outcome = requestedOutcome;
      if (outcome === 'completed' && dependencies.sessionStore && result?.session) {
        scheduleHistorySave(result.session);
      }
      try {
        if (outcome === 'completed') {
          dependencies.sessionRegistry.complete(active.session.id, active.clientKey);
        } else {
          dependencies.sessionRegistry.fail(active.session.id, active.clientKey);
        }
      } catch {
        logger.warn('SESSION_TERMINAL_TRANSITION_FAILED');
      }
      try {
        if (outcome === 'completed') {
          emit(active.session.id, 'complete', {
            ...result?.completionData,
            status: result?.status ?? 'completed',
            sessionId: result?.sessionId ?? active.session.id,
          });
        } else {
          emit(active.session.id, 'error', active.mode === 'byok'
            ? {
                error: 'LLM_PROVIDER_ERROR',
                ...(active.providerStatus === undefined
                  ? {}
                  : { status: active.providerStatus }),
              }
            : { error: 'AGENT_RUN_FAILED' });
        }
      } catch {
        logger.warn('SESSION_TERMINAL_EVENT_FAILED');
      }
    } finally {
      cleanupRun(active);
    }
  };
  const applyCompletionOutcome = async (
    active: ActiveRun,
    outcome: CompletionOutcome,
  ): Promise<boolean> => {
    if (outcome.kind === 'rejected') {
      active.providerStatus = outcome.providerStatus;
    }
    if (outcome.kind === 'resolved' && outcome.result?.status === 'blocked') {
      active.phase = 'blocked';
      emit(active.session.id, 'complete', {
        status: outcome.result.status,
        sessionId: outcome.result.sessionId,
      });
      return false;
    }
    await finalizeRun(
      active,
      outcome.kind === 'resolved' ? 'completed' : 'failed',
      outcome.kind === 'resolved' ? outcome.result : undefined,
    );
    return true;
  };
  const terminateRun = (
    active: ActiveRun,
    rejectedByUser: boolean,
  ): Promise<void> | null => {
    if (active.termination) {
      return active.termination;
    }
    if (active.phase !== 'running' && active.phase !== 'blocked') {
      return null;
    }
    const previousPhase = active.phase;
    active.phase = 'terminating';
    const operation = (async (): Promise<void> => {
      await Promise.resolve();
      try {
        const handle = active.handle;
        if (!handle?.abort) {
          throw new Error('Active run has no abort handle');
        }
        const abortOutcome = await abortWithTimeout(
          () => handle.abort!(),
          abortTimeoutMs,
        );
        if (abortOutcome === 'timed_out') {
          logger.warn('SESSION_ABORT_TIMEOUT');
          await finalizeRun(active, 'failed');
          return;
        }
        if (rejectedByUser) {
          if (handle.approve) {
            try {
              handle.approve(false);
            } catch {
              logger.warn('SESSION_APPROVAL_FAILED');
            }
          }
          try {
            emit(active.session.id, 'guardrail', {
              approved: false,
              sessionId: active.session.id,
            });
          } catch {
            logger.warn('SESSION_TERMINAL_EVENT_FAILED');
          }
        }
        await finalizeRun(active, 'failed');
      } catch (error) {
        let racedCompletionReachedTerminal = false;
        if (activeRuns.get(active.session.id) === active && active.phase === 'terminating') {
          const racedCompletion = active.pendingCompletionOutcome;
          active.pendingCompletionOutcome = undefined;
          active.phase = previousPhase;
          if (racedCompletion) {
            racedCompletionReachedTerminal = await applyCompletionOutcome(
              active,
              racedCompletion,
            );
          }
        }
        logger.warn('SESSION_ABORT_FAILED');
        if (racedCompletionReachedTerminal) {
          return;
        }
        throw error;
      } finally {
        active.termination = undefined;
      }
    })();
    active.termination = operation;
    return operation;
  };
  const observeCompletion = (
    active: ActiveRun,
    completion: Promise<AgentRunOutput | void>,
  ): void => {
    void completion.then(async (result) => {
      const outcome: CompletionOutcome = { kind: 'resolved', result };
      if (active.phase === 'terminating') {
        active.pendingCompletionOutcome = outcome;
        return;
      }
      if (active.phase !== 'running') {
        return;
      }
      await applyCompletionOutcome(active, outcome);
    }, async (error: unknown) => {
      const outcome: CompletionOutcome = {
        kind: 'rejected',
        providerStatus: safeProviderStatus(error),
      };
      if (active.phase === 'terminating') {
        active.pendingCompletionOutcome = outcome;
        return;
      }
      if (active.phase !== 'running') {
        return;
      }
      await applyCompletionOutcome(active, outcome);
    }).catch(() => logger.warn('SESSION_FINALIZATION_FAILED'));
  };

  const runLimiter = rateLimit({
    windowMs: dependencies.runRateLimit?.windowMs ?? DEFAULT_RUN_RATE_WINDOW_MS,
    limit: dependencies.runRateLimit?.limit ?? DEFAULT_RUN_RATE_LIMIT,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: 'RUN_RATE_LIMIT' });
    },
  });

  const sessionLimiter = rateLimit({
    windowMs: dependencies.sessionRateLimit?.windowMs ?? DEFAULT_RUN_RATE_WINDOW_MS,
    limit: dependencies.sessionRateLimit?.limit ?? DEFAULT_SESSION_RATE_LIMIT,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: 'SESSION_RATE_LIMIT' });
    },
  });

  router.post('/sessions', sessionLimiter, async (req: Request, res: Response) => {
    if (!isPlainObject(req.body) || Object.keys(req.body).length !== 0) {
      res.status(400).json({ error: 'INVALID_SESSION_REQUEST' });
      return;
    }
    try {
      const session = await dependencies.sessionRegistry.issue(normalizeClientKey(req));
      res.status(201).json({
        sessionId: session.id,
        mode: dependencies.policy.mode,
        capabilities: {
          allowedExperiences: dependencies.policy.allowedExperiences,
          allowByok: dependencies.policy.allowByok,
          allowProcessTools: dependencies.policy.allowProcessTools,
          allowServerCredentials: dependencies.policy.allowServerCredentials,
        },
        expiresAt: session.expiresAt.toISOString(),
      });
    } catch {
      res.status(500).json({ error: 'SESSION_ISSUE_FAILED' });
    }
  });

  router.post('/run', runLimiter, (req: Request, res: Response) => {
    const input = validateRunRequest(req.body);
    if (!input) {
      res.status(400).json({ error: 'INVALID_RUN_REQUEST' });
      return;
    }
    if (!dependencies.policy.allowedExperiences.includes(input.mode)) {
      res.status(403).json({ error: 'EXPERIENCE_NOT_ALLOWED' });
      return;
    }
    if (input.mode === 'byok' && !isSecureByokRequest(req)) {
      res.status(400).json({ error: 'BYOK_REQUIRES_HTTPS' });
      return;
    }

    const clientKey = normalizeClientKey(req);
    if (!dependencies.sessionRegistry.getAuthorized(input.sessionId, clientKey)) {
      res.status(404).json({ error: 'SESSION_NOT_FOUND' });
      return;
    }

    let session: PublicSession;
    try {
      session = dependencies.sessionRegistry.start(input.sessionId, clientKey);
    } catch (error) {
      if (error instanceof DuplicateSessionStartError) {
        res.status(409).json({ error: 'SESSION_ALREADY_RUNNING' });
        return;
      }
      if (error instanceof ConcurrentSessionLimitError) {
        res.status(429).json({ error: 'CONCURRENT_RUN_LIMIT' });
        return;
      }
      if (error instanceof SessionNotFoundError) {
        res.status(404).json({ error: 'SESSION_NOT_FOUND' });
        return;
      }
      res.status(500).json({ error: 'RUN_START_FAILED' });
      return;
    }

    const active: ActiveRun = {
      session,
      clientKey,
      mode: input.mode,
      phase: 'running',
    };
    activeRuns.set(session.id, active);
    const emitWhileActive = (type: SSEEvent['type'], data: unknown): void => {
      if (
        active.phase === 'terminating'
        || active.phase === 'terminal'
        || activeRuns.get(session.id) !== active
      ) {
        return;
      }
      emit(session.id, type, data);
    };
    try {
      if (input.mode === 'byok') {
        if (!dependencies.sseManager.setSecrets || !dependencies.sseManager.disconnect) {
          throw new Error('SSE secret redaction is unavailable');
        }
        dependencies.sseManager.setSecrets(session.id, [input.apiKey!]);
      }
      active.handle = toRunHandle(dependencies.agentRun({
        session,
        task: input.task,
        mode: input.mode,
        apiKey: input.apiKey,
        emit: emitWhileActive,
      }));
    } catch {
      active.phase = 'terminal';
      try {
        dependencies.sessionRegistry.fail(session.id, clientKey);
      } catch {
        logger.warn('SESSION_TERMINAL_TRANSITION_FAILED');
      }
      cleanupRun(active);
      res.status(500).json({ error: 'RUN_START_FAILED' });
      return;
    }

    emit(session.id, 'loop_step', { phase: 'starting', mode: input.mode });
    observeCompletion(active, active.handle.completion);

    res.status(202).json({ sessionId: session.id, status: 'started' });
  });

  router.get('/stream/:sessionId', (req: Request, res: Response) => {
    const { sessionId } = req.params;
    if (!dependencies.sessionRegistry.getAuthorized(sessionId, normalizeClientKey(req))) {
      res.status(404).json({ error: 'SESSION_NOT_FOUND' });
      return;
    }
    dependencies.sseManager.createConnection(sessionId, res);
    const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 15_000);
    req.on('close', () => {
      clearInterval(keepAlive);
      if (dependencies.sseManager.disconnect) {
        dependencies.sseManager.disconnect(sessionId);
      } else {
        dependencies.sseManager.close(sessionId);
      }
    });
  });

  router.post('/test-key', async (req: Request, res: Response) => {
    if (!dependencies.policy.allowServerCredentials) {
      res.status(403).json({ error: 'CONFIG_DISABLED' });
      return;
    }
    try {
      if (!dependencies.testKeyHandler) {
        res.status(503).json({ error: 'CONFIG_UNAVAILABLE' });
        return;
      }
      await dependencies.testKeyHandler(req, res);
    } catch {
      res.json({ valid: false, error: 'API_CONNECTION_FAILED' });
    }
  });

  const handleApproval = (approved: boolean) => async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const sessionId = isPlainObject(req.body) ? req.body.sessionId : undefined;
    if (typeof sessionId !== 'string') {
      res.status(400).json({ error: 'INVALID_APPROVAL_REQUEST' });
      return;
    }
    const clientKey = normalizeClientKey(req);
    if (!dependencies.sessionRegistry.getAuthorized(sessionId, clientKey)) {
      res.status(404).json({ error: 'SESSION_NOT_FOUND' });
      return;
    }
    const active = activeRuns.get(sessionId);
    if (!active) {
      res.status(404).json({ error: 'SESSION_NOT_FOUND' });
      return;
    }
    if (active.phase !== 'blocked') {
      res.status(409).json({ error: 'SESSION_NOT_BLOCKED' });
      return;
    }
    if (!approved) {
      const termination = terminateRun(active, true);
      if (!termination) {
        res.status(409).json({ error: 'SESSION_NOT_BLOCKED' });
        return;
      }
      try {
        await termination;
      } catch {
        res.status(500).json({ error: 'SESSION_REJECTION_FAILED' });
        return;
      }
    } else {
      const handle = active.handle;
      if (!handle?.continueAfterApproval) {
        res.status(409).json({ error: 'APPROVAL_CONTINUATION_UNAVAILABLE' });
        return;
      }
      active.phase = 'continuing';
      try {
        const continuation = handle.continueAfterApproval();
        try {
          emit(sessionId, 'guardrail', { approved: true, sessionId });
        } catch {
          logger.warn('SESSION_TERMINAL_EVENT_FAILED');
        }
        active.phase = 'running';
        observeCompletion(active, continuation);
      } catch {
        active.phase = 'blocked';
        logger.warn('SESSION_APPROVAL_FAILED');
        res.status(500).json({ error: 'APPROVAL_FAILED' });
        return;
      }
    }
    res.json({ sessionId, status: approved ? 'approved' : 'rejected' });
  };

  router.post('/approve', handleApproval(true));
  router.post('/reject', handleApproval(false));

  router.expireActiveSessions = async (): Promise<ActiveExpiryResult> => {
    const timestamp = now().getTime();
    const expired = [...activeRuns.values()].filter((active) => (
      active.session.expiresAt.getTime() <= timestamp
    ));
    const protectedSessionIds = new Set<string>();
    let failureCount = 0;
    for (const active of expired) {
      const termination = terminateRun(active, false);
      if (!termination || active.phase !== 'terminating') {
        protectedSessionIds.add(active.session.id);
        continue;
      }
      try {
        await termination;
      } catch {
        failureCount += 1;
        protectedSessionIds.add(active.session.id);
      }
    }
    return { protectedSessionIds, failureCount };
  };

  return router;
};
