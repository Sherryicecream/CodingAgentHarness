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
}

export interface AgentRunHandle {
  readonly completion: Promise<AgentRunOutput | void>;
  approve?(approved: boolean): void;
  abort?(): void;
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
}

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
): Router => {
  const router = Router();
  const now = dependencies.now ?? (() => new Date());
  const activeRuns = new Map<string, AgentRunHandle>();
  const emit = (sessionId: string, type: SSEEvent['type'], data: unknown): void => {
    dependencies.sseManager.push(sessionId, { type, data, timestamp: now() });
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

  router.post('/sessions', async (req: Request, res: Response) => {
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

    activeRuns.set(session.id, handle);
    emit(session.id, 'loop_step', { phase: 'starting', mode: input.mode });
    void handle.completion.then((result) => {
      if (result?.status === 'blocked') {
        emit(session.id, 'complete', { status: result.status, sessionId: result.sessionId });
        return;
      }
      dependencies.sessionRegistry.complete(session.id, clientKey);
      emit(session.id, 'complete', {
        status: result?.status ?? 'completed',
        sessionId: result?.sessionId ?? session.id,
      });
      activeRuns.delete(session.id);
      dependencies.sseManager.close(session.id);
    }).catch(() => {
      dependencies.sessionRegistry.fail(session.id, clientKey);
      emit(session.id, 'error', { error: 'AGENT_RUN_FAILED' });
      activeRuns.delete(session.id);
      dependencies.sseManager.close(session.id);
    });

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

  const handleApproval = (approved: boolean) => (req: Request, res: Response): void => {
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
    const handle = activeRuns.get(sessionId);
    if (!handle?.approve) {
      res.status(404).json({ error: 'SESSION_NOT_FOUND' });
      return;
    }
    handle.approve(approved);
    emit(sessionId, 'guardrail', { approved, sessionId });
    if (!approved) {
      dependencies.sessionRegistry.fail(sessionId, clientKey);
      activeRuns.delete(sessionId);
      dependencies.sseManager.close(sessionId);
    }
    res.json({ sessionId, status: approved ? 'approved' : 'rejected' });
  };

  router.post('/approve', handleApproval(true));
  router.post('/reject', handleApproval(false));

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
  return {
    completion: loop.run(task, session.workspace).then((result) => ({
      status: result.status,
      sessionId: result.session.id,
    })),
    approve: (approved) => loop.handleApproval(approved),
    abort: () => loop.abort(),
  };
};
