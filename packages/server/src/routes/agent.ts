import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  DeepSeekAdapter,
  MockLLMAdapter,
  createAgentLoop,
  createContextBuilder,
  createFailureClassifier,
  createFeedbackLoop,
  createFixSuggestionBuilder,
  createGovernanceService,
  createResultParser,
  createStopCondition,
  createTestRunner,
  type AgentLoop,
  type Session,
  type SessionStore,
} from '@harness/core';
import { createPolicyToolRegistry } from '../agent/tool-registry-factory.js';
import type { CredentialStore } from '../credential-store.js';
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

export interface AgentRunInput {
  readonly session: PublicSession;
  readonly task: string;
  readonly mode: RuntimeExperience;
  readonly apiKey?: string;
  readonly emit: (type: SSEEvent['type'], data: unknown) => void;
}

export interface AgentRunOutput {
  readonly status: string;
  readonly sessionId?: string;
  readonly session?: Session;
}

export interface AgentRunHandle {
  readonly completion: Promise<AgentRunOutput | void>;
  continueAfterApproval?(): Promise<AgentRunOutput | void>;
  approve?(approved: boolean): void;
  abort?(): void | Promise<void>;
}

export type AgentRun = (
  input: AgentRunInput,
) => Promise<AgentRunOutput | void> | AgentRunHandle;

export interface AgentRouterDependencies {
  readonly policy: RuntimePolicy;
  readonly sessionRegistry: SessionRegistry;
  readonly sseManager: SSEManager;
  readonly agentRun: AgentRun;
  readonly now?: () => Date;
  readonly fetchImpl?: typeof fetch;
  readonly credentialStore: CredentialStore;
  readonly runRateLimit?: RunRateLimitOptions;
  readonly sessionRateLimit?: RunRateLimitOptions;
  readonly logger?: Pick<Console, 'warn'>;
  readonly sessionStore?: SessionStore;
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

export const createAgentRouter = (
  dependencies: AgentRouterDependencies,
): AgentRouter => {
  const router = Router() as AgentRouter;
  const now = dependencies.now ?? (() => new Date());
  const logger = dependencies.logger ?? console;
  type CompletionOutcome =
    | { readonly kind: 'resolved'; readonly result: AgentRunOutput | void }
    | { readonly kind: 'rejected' };
  interface ActiveRun {
    readonly session: PublicSession;
    readonly clientKey: string;
    readonly handle: AgentRunHandle;
    phase: 'running' | 'blocked' | 'continuing' | 'terminating' | 'terminal';
    termination?: Promise<void>;
    pendingCompletionOutcome?: CompletionOutcome;
  }
  const activeRuns = new Map<string, ActiveRun>();
  const emit = (sessionId: string, type: SSEEvent['type'], data: unknown): void => {
    dependencies.sseManager.push(sessionId, { type, data, timestamp: now() });
  };
  const cleanupRun = (active: ActiveRun): void => {
    if (activeRuns.get(active.session.id) === active) {
      activeRuns.delete(active.session.id);
    }
    try {
      dependencies.sseManager.close(active.session.id);
    } catch {
      logger.warn('SESSION_SSE_CLOSE_FAILED');
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
      let outcome = requestedOutcome;
      if (outcome === 'completed' && dependencies.sessionStore && result?.session) {
        try {
          await dependencies.sessionStore.save(result.session);
        } catch {
          logger.warn('SESSION_HISTORY_SAVE_FAILED');
          outcome = 'failed';
        }
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
            status: result?.status ?? 'completed',
            sessionId: result?.sessionId ?? active.session.id,
          });
        } else {
          emit(active.session.id, 'error', { error: 'AGENT_RUN_FAILED' });
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
        if (!active.handle.abort) {
          throw new Error('Active run has no abort handle');
        }
        await active.handle.abort();
        if (rejectedByUser) {
          if (active.handle.approve) {
            try {
              active.handle.approve(false);
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
    }, async () => {
      const outcome: CompletionOutcome = { kind: 'rejected' };
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

    let handle: AgentRunHandle;
    try {
      handle = toRunHandle(dependencies.agentRun({
        session,
        task: input.task,
        mode: input.mode,
        apiKey: input.apiKey,
        emit: (type, data) => emit(session.id, type, data),
      }));
    } catch {
      dependencies.sessionRegistry.fail(session.id, clientKey);
      res.status(500).json({ error: 'RUN_START_FAILED' });
      return;
    }

    const active: ActiveRun = {
      session,
      clientKey,
      handle,
      phase: 'running',
    };
    activeRuns.set(session.id, active);
    emit(session.id, 'loop_step', { phase: 'starting', mode: input.mode });
    observeCompletion(active, handle.completion);

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
      dependencies.sseManager.close(sessionId);
    });
  });

  router.post('/test-key', async (_req: Request, res: Response) => {
    if (!dependencies.policy.allowServerCredentials) {
      res.status(403).json({ error: 'CONFIG_DISABLED' });
      return;
    }
    const apiKey = dependencies.credentialStore.getKey('harness/deepseek-api-key');
    if (!apiKey) {
      res.json({ valid: false, error: 'API_KEY_NOT_CONFIGURED' });
      return;
    }
    try {
      const response = await (dependencies.fetchImpl ?? fetch)(
        `${process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: 'Hello' }],
            max_tokens: 5,
          }),
        },
      );
      res.json(response.ok
        ? { valid: true }
        : { valid: false, error: `API returned ${response.status}` });
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
      if (!active.handle.continueAfterApproval) {
        res.status(409).json({ error: 'APPROVAL_CONTINUATION_UNAVAILABLE' });
        return;
      }
      active.phase = 'continuing';
      try {
        const continuation = active.handle.continueAfterApproval();
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

export interface DefaultAgentRunOptions {
  readonly policy: RuntimePolicy;
  readonly credentialStore: CredentialStore;
}

export const createDefaultAgentRun = (
  options: DefaultAgentRunOptions,
): AgentRun => ({ session, task, mode, emit }) => {
  const tools = createPolicyToolRegistry(options.policy, session.workspace);
  const governance = createGovernanceService();
  const feedback = createFeedbackLoop(
    createTestRunner(),
    createResultParser(),
    createFailureClassifier(),
    createFixSuggestionBuilder(),
  );
  let apiKey = '';
  if (mode === 'server' && options.policy.allowServerCredentials) {
    apiKey = options.credentialStore.getKey('harness/deepseek-api-key') || '';
  }
  const llm = apiKey
    ? new DeepSeekAdapter({
        apiKey,
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
  const loop: AgentLoop = createAgentLoop({
    llm,
    tools,
    governance,
    feedback,
    contextBuilder: createContextBuilder(),
    stopCondition: createStopCondition(),
    config: { maxIterations: 10 },
    onEvent: (type, data) => emit(type as SSEEvent['type'], data),
  });
  const mapResult = (completion: ReturnType<AgentLoop['run']>): Promise<AgentRunOutput> => (
    completion.then((result) => ({
      status: result.status,
      sessionId: result.session.id,
      session: result.session,
    }))
  );
  let activeCompletion = mapResult(loop.run(task, session.workspace));
  return {
    completion: activeCompletion,
    continueAfterApproval: () => {
      activeCompletion = mapResult(loop.continueAfterApproval(true));
      return activeCompletion;
    },
    approve: (approved) => loop.handleApproval(approved),
    abort: async () => {
      loop.abort();
      await activeCompletion.catch(() => undefined);
    },
  };
};
