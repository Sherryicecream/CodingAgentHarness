import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type AppOptions } from '../../src/app.js';
import { createSessionRegistry, type SessionRegistry } from '../../src/session/session-registry.js';
import { createWorkspaceManager } from '../../src/session/workspace-manager.js';
import type { SSEManager } from '../../src/sse/sse-manager.js';

const temporaryPaths: string[] = [];
const createdApps: Array<{ close?: () => void | Promise<void> }> = [];

const createWorkspaceRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'harness-public-routes-'));
  temporaryPaths.push(root);
  return root;
};

const pendingRun = (): Promise<never> => new Promise(() => undefined);
const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const createPublicApp = async (overrides: Partial<AppOptions> = {}) => {
  const app = createApp({
    mode: 'public',
    workspaceRoot: await createWorkspaceRoot(),
    agentRun: pendingRun,
    ...overrides,
  });
  createdApps.push(app);
  return app;
};

afterEach(async () => {
  await Promise.all(createdApps.splice(0).map((app) => app.close?.()));
  vi.unstubAllEnvs();
  vi.useRealTimers();
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

describe('public agent request boundaries', () => {
  it('issues a server-owned session with policy-derived public capabilities', async () => {
    const app = await createPublicApp({
      idGenerator: () => 'server-issued-session',
      now: () => new Date('2026-08-08T00:00:00.000Z'),
    });

    const response = await request(app).post('/api/agent/sessions').send({});

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      sessionId: 'server-issued-session',
      mode: 'public',
      workspaceRetention: 'temporary',
      capabilities: {
        allowedExperiences: ['demo'],
        allowByok: false,
        allowProcessTools: false,
        allowServerCredentials: false,
        allowHttpByok: false,
      },
      expiresAt: '2026-08-08T01:00:00.000Z',
    });
    expect(response.body).toHaveProperty('workspaceRoot');
    expect(response.body).not.toHaveProperty('clientKey');
  });

  it('accepts session creation with no JSON body as well as an empty object', async () => {
    const ids = ['no-body-session', 'empty-object-session'];
    const app = await createPublicApp({ idGenerator: () => ids.shift()! });

    const withoutBody = await request(app).post('/api/agent/sessions');
    const withEmptyObject = await request(app).post('/api/agent/sessions').send({});

    expect(withoutBody.status).toBe(201);
    expect(withoutBody.body.sessionId).toBe('no-body-session');
    expect(withEmptyObject.status).toBe(201);
    expect(withEmptyObject.body.sessionId).toBe('empty-object-session');
  });

  it.each([
    [{ sessionId: 'issued', task: 'work', mode: 'demo', workingDir: 'C:\\' }],
    [{ sessionId: 'issued', task: 'work', mode: 'demo', extra: true }],
    [{ sessionId: 'issued', task: '', mode: 'demo' }],
    [{ sessionId: 'issued', task: ' '.repeat(3), mode: 'demo' }],
    [{ sessionId: 'issued', task: 'x'.repeat(1_001), mode: 'demo' }],
  ])('rejects invalid and unknown run fields without starting work', async (body) => {
    const app = await createPublicApp({ idGenerator: () => 'issued' });
    await request(app).post('/api/agent/sessions').send({});

    const response = await request(app).post('/api/agent/run').send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'INVALID_RUN_REQUEST' });
  });

  it('returns the same non-enumerating response for unknown and wrong-owner sessions', async () => {
    const app = await createPublicApp({
      idGenerator: () => 'owned-session',
      trustProxy: 1,
    });
    await request(app)
      .post('/api/agent/sessions')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({});

    const unknown = await request(app)
      .post('/api/agent/run')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({ sessionId: 'unknown', task: 'work', mode: 'demo' });
    const wrongOwner = await request(app)
      .post('/api/agent/run')
      .set('X-Forwarded-For', '203.0.113.11')
      .send({ sessionId: 'owned-session', task: 'work', mode: 'demo' });

    expect(unknown.status).toBe(404);
    expect(wrongOwner.status).toBe(404);
    expect(unknown.body).toEqual({ error: 'SESSION_NOT_FOUND' });
    expect(wrongOwner.body).toEqual(unknown.body);
  });

  it('uses an explicitly configured proxy hop for ownership and per-client rate limits', async () => {
    vi.stubEnv('HARNESS_TRUST_PROXY', '1');
    const app = await createPublicApp({
      idGenerator: () => 'proxy-owned-session',
      runRateLimit: { limit: 1, windowMs: 60_000 },
    });
    await request(app)
      .post('/api/agent/sessions')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({});

    const wrongOwner = await request(app)
      .post('/api/agent/run')
      .set('X-Forwarded-For', '203.0.113.11')
      .send({ sessionId: 'proxy-owned-session', task: 'work', mode: 'demo' });
    const sameClientLimited = await request(app)
      .post('/api/agent/run')
      .set('X-Forwarded-For', '203.0.113.11')
      .send({ sessionId: 'missing', task: 'again', mode: 'demo' });
    const otherClient = await request(app)
      .post('/api/agent/run')
      .set('X-Forwarded-For', '203.0.113.12')
      .send({ sessionId: 'missing', task: 'independent', mode: 'demo' });

    expect(wrongOwner.status).toBe(404);
    expect(sameClientLimited.status).toBe(429);
    expect(otherClient.status).toBe(404);
  });

  it('accepts a restricted proxy allowlist without enabling permissive trust', async () => {
    const app = await createPublicApp({
      idGenerator: () => 'allowlist-owned-session',
      trustProxy: ['loopback'],
    });
    await request(app)
      .post('/api/agent/sessions')
      .set('X-Forwarded-For', '203.0.113.20')
      .send({});

    const wrongOwner = await request(app)
      .post('/api/agent/run')
      .set('X-Forwarded-For', '203.0.113.21')
      .send({ sessionId: 'allowlist-owned-session', task: 'work', mode: 'demo' });

    expect(wrongOwner.status).toBe(404);
  });

  it.each([
    [true],
    ['true'],
  ])('rejects permissive trust-proxy configuration %j', (trustProxy) => {
    expect(() => createApp({ mode: 'public', trustProxy: trustProxy as never }))
      .toThrow(/trust proxy/i);
  });

  it('rejects a duplicate run for the same session', async () => {
    const app = await createPublicApp({ idGenerator: () => 'duplicate-session' });
    await request(app).post('/api/agent/sessions').send({});

    const first = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'duplicate-session', task: 'first', mode: 'demo' });
    const duplicate = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'duplicate-session', task: 'second', mode: 'demo' });

    expect(first.status).toBe(202);
    expect(first.body).toEqual({ sessionId: 'duplicate-session', status: 'started' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({ error: 'SESSION_ALREADY_RUNNING' });
  });

  it('does not approve or reject a run until it is actually blocked', async () => {
    let approvalCalls = 0;
    let abortCalls = 0;
    const app = await createPublicApp({
      idGenerator: () => 'still-running',
      agentRun: () => ({
        completion: pendingRun(),
        approve: () => { approvalCalls += 1; },
        abort: () => { abortCalls += 1; },
      }),
    });
    await request(app).post('/api/agent/sessions').send({});
    await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'still-running', task: 'work', mode: 'demo' });

    const rejected = await request(app)
      .post('/api/agent/reject')
      .send({ sessionId: 'still-running' });

    expect(rejected.status).toBe(409);
    expect(rejected.body).toEqual({ error: 'SESSION_NOT_BLOCKED' });
    expect(approvalCalls).toBe(0);
    expect(abortCalls).toBe(0);
  });

  it('aborts and cleans a blocked run exactly once when rejected', async () => {
    let resolveCompletion!: (value: { status: string }) => void;
    const completion = new Promise<{ status: string }>((resolve) => {
      resolveCompletion = resolve;
    });
    let approvalCalls = 0;
    let abortCalls = 0;
    let closeCalls = 0;
    const sseManager: SSEManager = {
      createConnection: () => undefined,
      push: () => undefined,
      close: () => { closeCalls += 1; },
    };
    const app = await createPublicApp({
      idGenerator: () => 'blocked-run',
      sseManager,
      agentRun: () => ({
        completion,
        approve: () => { approvalCalls += 1; },
        abort: () => { abortCalls += 1; },
      }),
    });
    await request(app).post('/api/agent/sessions').send({});
    await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'blocked-run', task: 'work', mode: 'demo' });
    resolveCompletion({ status: 'blocked' });
    await nextTurn();

    const rejected = await request(app)
      .post('/api/agent/reject')
      .send({ sessionId: 'blocked-run' });
    const repeated = await request(app)
      .post('/api/agent/reject')
      .send({ sessionId: 'blocked-run' });

    expect(rejected.status).toBe(200);
    expect(repeated.status).toBe(404);
    expect(approvalCalls).toBe(1);
    expect(abortCalls).toBe(1);
    expect(closeCalls).toBe(1);
  });

  it('serializes a deferred rejection against a concurrent approval', async () => {
    let resolveBlocked!: (value: { status: string }) => void;
    const completion = new Promise<{ status: string }>((resolve) => {
      resolveBlocked = resolve;
    });
    let markAbortStarted!: () => void;
    const abortStarted = new Promise<void>((resolve) => { markAbortStarted = resolve; });
    let releaseAbort!: () => void;
    const abortGate = new Promise<void>((resolve) => { releaseAbort = resolve; });
    let abortCalls = 0;
    let continuationCalls = 0;
    let closeCalls = 0;
    const events: Array<{ type: string; data: unknown }> = [];
    const app = await createPublicApp({
      idGenerator: () => 'reject-approve-race',
      agentRun: () => ({
        completion,
        abort: async () => {
          abortCalls += 1;
          markAbortStarted();
          await abortGate;
        },
        continueAfterApproval: () => {
          continuationCalls += 1;
          return pendingRun();
        },
      }),
      sseManager: {
        createConnection: () => undefined,
        push: (_sessionId, event) => { events.push(event); },
        close: () => { closeCalls += 1; },
      },
    });
    await request(app).post('/api/agent/sessions').send({});
    await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'reject-approve-race', task: 'work', mode: 'demo' });
    resolveBlocked({ status: 'blocked' });
    await nextTurn();

    const rejecting = request(app)
      .post('/api/agent/reject')
      .send({ sessionId: 'reject-approve-race' })
      .then((response) => response);
    await abortStarted;
    const approved = await request(app)
      .post('/api/agent/approve')
      .send({ sessionId: 'reject-approve-race' });
    releaseAbort();
    const rejected = await rejecting;

    const guardrailDecisions = events
      .filter((event) => event.type === 'guardrail')
      .map((event) => (event.data as { approved?: boolean }).approved);
    expect(rejected.status).toBe(200);
    expect(approved.status).toBe(409);
    expect(abortCalls).toBe(1);
    expect(continuationCalls).toBe(0);
    expect(guardrailDecisions).toEqual([false]);
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
    expect(closeCalls).toBe(1);
  });

  it('serializes two deferred rejection requests', async () => {
    let resolveBlocked!: (value: { status: string }) => void;
    const completion = new Promise<{ status: string }>((resolve) => {
      resolveBlocked = resolve;
    });
    let markAbortStarted!: () => void;
    const abortStarted = new Promise<void>((resolve) => { markAbortStarted = resolve; });
    let releaseAbort!: () => void;
    const abortGate = new Promise<void>((resolve) => { releaseAbort = resolve; });
    let abortCalls = 0;
    let closeCalls = 0;
    const events: Array<{ type: string; data: unknown }> = [];
    const app = await createPublicApp({
      idGenerator: () => 'double-reject-race',
      agentRun: () => ({
        completion,
        abort: async () => {
          abortCalls += 1;
          markAbortStarted();
          await abortGate;
        },
      }),
      sseManager: {
        createConnection: () => undefined,
        push: (_sessionId, event) => { events.push(event); },
        close: () => { closeCalls += 1; },
      },
    });
    await request(app).post('/api/agent/sessions').send({});
    await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'double-reject-race', task: 'work', mode: 'demo' });
    resolveBlocked({ status: 'blocked' });
    await nextTurn();

    const firstRequest = request(app)
      .post('/api/agent/reject')
      .send({ sessionId: 'double-reject-race' })
      .then((response) => response);
    await abortStarted;
    const secondRequest = request(app)
      .post('/api/agent/reject')
      .send({ sessionId: 'double-reject-race' })
      .then((response) => response);
    const second = await secondRequest;
    releaseAbort();
    const first = await firstRequest;

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(abortCalls).toBe(1);
    expect(events.filter((event) => event.type === 'guardrail')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
    expect(closeCalls).toBe(1);
  });

  it('lets a claimed rejection win over a concurrent expiry sweep', async () => {
    let currentTime = new Date('2026-08-08T00:00:00.000Z');
    const root = await createWorkspaceRoot();
    let resolveBlocked!: (value: { status: string }) => void;
    const completion = new Promise<{ status: string }>((resolve) => {
      resolveBlocked = resolve;
    });
    let markAbortStarted!: () => void;
    const abortStarted = new Promise<void>((resolve) => { markAbortStarted = resolve; });
    let releaseAbort!: () => void;
    const abortGate = new Promise<void>((resolve) => { releaseAbort = resolve; });
    let abortCalls = 0;
    let closeCalls = 0;
    const events: Array<{ type: string; data: unknown }> = [];
    const app = createApp({
      mode: 'public',
      workspaceRoot: root,
      idGenerator: () => 'reject-sweep-race',
      now: () => new Date(currentTime),
      agentRun: () => ({
        completion,
        abort: async () => {
          abortCalls += 1;
          markAbortStarted();
          await abortGate;
        },
      }),
      sseManager: {
        createConnection: () => undefined,
        push: (_sessionId, event) => { events.push(event); },
        close: () => { closeCalls += 1; },
      },
    });
    createdApps.push(app);
    await request(app).post('/api/agent/sessions').send({});
    await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'reject-sweep-race', task: 'work', mode: 'demo' });
    resolveBlocked({ status: 'blocked' });
    await nextTurn();

    const rejecting = request(app)
      .post('/api/agent/reject')
      .send({ sessionId: 'reject-sweep-race' })
      .then((response) => response);
    await abortStarted;
    currentTime = new Date('2026-08-08T01:00:00.000Z');
    const sweep = app.sweepSessions();
    await nextTurn();
    releaseAbort();
    const [rejected] = await Promise.all([rejecting, sweep]);

    expect(rejected.status).toBe(200);
    expect(abortCalls).toBe(1);
    expect(events.filter((event) => event.type === 'guardrail')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
    expect(closeCalls).toBe(1);
    await expect(realpath(join(root, 'reject-sweep-race')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('continues an approved blocked run to terminal cleanup and releases concurrency', async () => {
    let resolveBlocked!: (value: { status: string }) => void;
    const blockedCompletion = new Promise<{ status: string }>((resolve) => {
      resolveBlocked = resolve;
    });
    let continuationCalls = 0;
    let closeCalls = 0;
    const ids = ['approval-first', 'approval-second'];
    const app = await createPublicApp({
      idGenerator: () => ids.shift()!,
      maxConcurrent: 1,
      sseManager: {
        createConnection: () => undefined,
        push: () => undefined,
        close: () => { closeCalls += 1; },
      },
      agentRun: () => ({
        completion: blockedCompletion,
        approve: () => undefined,
        continueAfterApproval: async () => {
          continuationCalls += 1;
          return { status: 'completed', sessionId: 'approved-terminal' };
        },
      }),
    });
    await request(app).post('/api/agent/sessions').send({});
    await request(app).post('/api/agent/sessions').send({});
    await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'approval-first', task: 'first', mode: 'demo' });
    resolveBlocked({ status: 'blocked' });
    await nextTurn();

    const approved = await request(app)
      .post('/api/agent/approve')
      .send({ sessionId: 'approval-first' });
    await nextTurn();
    const second = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'approval-second', task: 'second', mode: 'demo' });

    expect(approved.status).toBe(200);
    expect(continuationCalls).toBe(1);
    expect(closeCalls).toBe(1);
    expect(second.status).toBe(202);
  });

  it('cleans a terminal run without a second transition or unhandled rejection', async () => {
    const root = await createWorkspaceRoot();
    const actualRegistry = createSessionRegistry({
      workspaceManager: createWorkspaceManager({ root }),
      idGenerator: () => 'terminal-race',
    });
    let completeCalls = 0;
    let failCalls = 0;
    const registry: SessionRegistry = {
      ...actualRegistry,
      complete() {
        completeCalls += 1;
        throw new Error('injected completion transition failure');
      },
      fail() {
        failCalls += 1;
        throw new Error('a second terminal transition must not run');
      },
    };
    let closeCalls = 0;
    const warnings: unknown[] = [];
    const app = createApp({
      mode: 'public',
      sessionRegistry: registry,
      sseManager: {
        createConnection: () => undefined,
        push: () => undefined,
        close: () => { closeCalls += 1; },
      },
      agentRun: async () => ({ status: 'completed' }),
      logger: {
        error: () => undefined,
        info: () => undefined,
        warn: (value) => { warnings.push(value); },
      },
    });
    createdApps.push(app);
    await request(app).post('/api/agent/sessions').send({});

    await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'terminal-race', task: 'work', mode: 'demo' });
    await nextTurn();

    const noLongerActive = await request(app)
      .post('/api/agent/reject')
      .send({ sessionId: 'terminal-race' });
    expect(noLongerActive.status).toBe(404);
    expect(completeCalls).toBe(1);
    expect(failCalls).toBe(0);
    expect(closeCalls).toBe(1);
    expect(warnings).toContain('SESSION_TERMINAL_TRANSITION_FAILED');
  });

  it('maps per-client concurrent run excess to 429', async () => {
    const ids = ['first-session', 'second-session'];
    const app = await createPublicApp({
      idGenerator: () => ids.shift()!,
      maxConcurrent: 1,
    });
    await request(app).post('/api/agent/sessions').send({});
    await request(app).post('/api/agent/sessions').send({});

    const first = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'first-session', task: 'first', mode: 'demo' });
    const excess = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'second-session', task: 'second', mode: 'demo' });

    expect(first.status).toBe(202);
    expect(excess.status).toBe(429);
    expect(excess.body).toEqual({ error: 'CONCURRENT_RUN_LIMIT' });
  });

  it.each([
    { mode: 'byok' as const, apiKey: 'forged-public-key' },
    { mode: 'server' as const },
  ])('rejects forged public $mode runs before agent construction', async ({ mode, apiKey }) => {
    let agentRunCalls = 0;
    const app = await createPublicApp({
      idGenerator: () => 'policy-session',
      agentRun: () => {
        agentRunCalls += 1;
        return pendingRun();
      },
    });
    await request(app).post('/api/agent/sessions').send({});

    const response = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'policy-session', task: 'work', mode, ...(apiKey ? { apiKey } : {}) });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'EXPERIENCE_NOT_ALLOWED' });
    expect(agentRunCalls).toBe(0);
  });

  it('rate limits run attempts independently of session validity', async () => {
    const app = await createPublicApp({
      runRateLimit: { limit: 1, windowMs: 60_000 },
    });

    const first = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'missing', task: 'first', mode: 'demo' });
    const limited = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'missing', task: 'second', mode: 'demo' });

    expect(first.status).toBe(404);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: 'RUN_RATE_LIMIT' });
  });

  it('rate limits anonymous session issuance to bound workspace creation', async () => {
    const app = await createPublicApp({
      sessionRateLimit: { limit: 1, windowMs: 60_000 },
    });

    const first = await request(app).post('/api/agent/sessions').send({});
    const limited = await request(app).post('/api/agent/sessions').send({});

    expect(first.status).toBe(201);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: 'SESSION_RATE_LIMIT' });
  });

  it('periodically removes expired session records and their workspaces', async () => {
    let currentTime = new Date('2026-08-08T00:00:00.000Z');
    const root = await createWorkspaceRoot();
    let tick: (() => void | Promise<void>) | undefined;
    const app = createApp({
      mode: 'public',
      workspaceRoot: root,
      idGenerator: () => 'scheduled-expiry',
      now: () => new Date(currentTime),
      agentRun: pendingRun,
      sweepIntervalMs: 1_000,
      intervalScheduler: {
        setInterval(callback) {
          tick = callback;
          return { unref: () => undefined };
        },
        clearInterval: () => undefined,
      },
    });
    createdApps.push(app);
    await request(app).post('/api/agent/sessions').send({});
    const workspace = join(root, 'scheduled-expiry');
    expect(await realpath(workspace)).toBe(workspace);

    currentTime = new Date('2026-08-08T01:00:00.000Z');
    expect(tick).toBeDefined();
    await tick!();

    await expect(realpath(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
    const expired = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'scheduled-expiry', task: 'work', mode: 'demo' });
    expect(expired.status).toBe(404);
  });

  it('coordinates an active run to terminal state before sweeping its expired workspace', async () => {
    let currentTime = new Date('2026-08-08T00:00:00.000Z');
    const root = await createWorkspaceRoot();
    const ids = ['expiring-active', 'after-expiry'];
    let tick: (() => void | Promise<void>) | undefined;
    let abortCalls = 0;
    let abortSettled = false;
    let sweepObservedAbortSettled = false;
    let rejectCompletion!: (error: Error) => void;
    const completion = new Promise<never>((_resolve, reject) => {
      rejectCompletion = reject;
    });
    let releaseAbort!: () => void;
    const abortGate = new Promise<void>((resolve) => { releaseAbort = resolve; });
    let closeCalls = 0;
    const events: string[] = [];
    const actualRegistry = createSessionRegistry({
      workspaceManager: createWorkspaceManager({ root }),
      now: () => new Date(currentTime),
      idGenerator: () => ids.shift()!,
      maxConcurrent: 1,
    });
    const sessionRegistry: SessionRegistry = {
      ...actualRegistry,
      async sweepExpired() {
        sweepObservedAbortSettled = abortSettled;
        return actualRegistry.sweepExpired();
      },
    };
    const app = createApp({
      mode: 'public',
      workspaceRoot: root,
      sessionRegistry,
      now: () => new Date(currentTime),
      agentRun: ({ session }) => ({
        completion: session.id === 'expiring-active' ? completion : pendingRun(),
        abort: async () => {
          abortCalls += 1;
          await abortGate;
          abortSettled = true;
        },
      }),
      sseManager: {
        createConnection: () => undefined,
        push: (_sessionId, event) => { events.push(event.type); },
        close: () => { closeCalls += 1; },
      },
      intervalScheduler: {
        setInterval(callback) {
          tick = callback;
          return { unref: () => undefined };
        },
        clearInterval: () => undefined,
      },
    });
    createdApps.push(app);
    await request(app).post('/api/agent/sessions').send({});
    await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'expiring-active', task: 'work', mode: 'demo' });
    const workspace = join(root, 'expiring-active');

    currentTime = new Date('2026-08-08T01:00:00.000Z');
    const sweep = Promise.resolve(tick!());
    await nextTurn();
    rejectCompletion(new Error('completion lost the expiry race'));
    await nextTurn();
    const closeCallsBeforeAbortSettled = closeCalls;
    let workspaceExistedUntilAbortSettled = true;
    try {
      await realpath(workspace);
    } catch {
      workspaceExistedUntilAbortSettled = false;
    }
    releaseAbort();
    await sweep;

    expect(workspaceExistedUntilAbortSettled).toBe(true);
    expect(closeCallsBeforeAbortSettled).toBe(0);
    await expect(realpath(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
    const expired = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'expiring-active', task: 'again', mode: 'demo' });
    const newlyIssued = await request(app).post('/api/agent/sessions').send({});
    const replacement = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'after-expiry', task: 'replacement', mode: 'demo' });

    expect(abortCalls).toBe(1);
    expect(sweepObservedAbortSettled).toBe(true);
    expect(closeCalls).toBe(1);
    expect(events).toContain('error');
    expect(expired.status).toBe(404);
    expect(newlyIssued.status).toBe(201);
    expect(replacement.status).toBe(202);
  });

  it.each([
    { settlement: 'resolve' as const, expectedEvent: 'complete' },
    { settlement: 'reject' as const, expectedEvent: 'error' },
  ])('retains a raced completion $settlement when expiry abort fails', async ({
    settlement,
    expectedEvent,
  }) => {
    let currentTime = new Date('2026-08-08T00:00:00.000Z');
    const root = await createWorkspaceRoot();
    const ids = [`raced-${settlement}`, `replacement-${settlement}`];
    let resolveCompletion!: (value: { status: string; sessionId: string }) => void;
    let rejectCompletion!: (error: Error) => void;
    const completion = new Promise<{ status: string; sessionId: string }>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    let markAbortStarted!: () => void;
    const abortStarted = new Promise<void>((resolve) => { markAbortStarted = resolve; });
    let rejectAbort!: (error: Error) => void;
    const abortFailure = new Promise<void>((_resolve, reject) => { rejectAbort = reject; });
    const warnings: unknown[] = [];
    const events: string[] = [];
    let closeCalls = 0;
    let abortCalls = 0;
    const app = createApp({
      mode: 'public',
      workspaceRoot: root,
      idGenerator: () => ids.shift()!,
      now: () => new Date(currentTime),
      maxConcurrent: 1,
      logger: {
        error: () => undefined,
        info: () => undefined,
        warn: (message) => { warnings.push(message); },
      },
      agentRun: ({ session }) => session.id === `raced-${settlement}` ? {
        completion,
        abort: async () => {
          abortCalls += 1;
          markAbortStarted();
          await abortFailure;
        },
      } : {
        completion: pendingRun(),
        abort: () => undefined,
      },
      sseManager: {
        createConnection: () => undefined,
        push: (_sessionId, event) => { events.push(event.type); },
        close: () => { closeCalls += 1; },
      },
    });
    createdApps.push(app);
    await request(app).post('/api/agent/sessions').send({});
    await request(app)
      .post('/api/agent/run')
      .send({ sessionId: `raced-${settlement}`, task: 'race', mode: 'demo' });

    currentTime = new Date('2026-08-08T01:00:00.000Z');
    const sweep = app.sweepSessions();
    await abortStarted;
    if (settlement === 'resolve') {
      resolveCompletion({ status: 'completed', sessionId: `raced-${settlement}` });
    } else {
      rejectCompletion(new Error('run completed with failure'));
    }
    await nextTurn();
    rejectAbort(new Error('abort lost race with completion'));
    await sweep;

    await expect(realpath(join(root, `raced-${settlement}`)))
      .rejects.toMatchObject({ code: 'ENOENT' });
    const replacementIssued = await request(app).post('/api/agent/sessions').send({});
    const replacement = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: `replacement-${settlement}`, task: 'replacement', mode: 'demo' });

    expect(abortCalls).toBe(1);
    expect(closeCalls).toBe(1);
    expect(events.filter((event) => event === expectedEvent)).toHaveLength(1);
    expect(events.filter((event) => event === (expectedEvent === 'complete' ? 'error' : 'complete')))
      .toHaveLength(0);
    expect(warnings).toContain('SESSION_ABORT_FAILED');
    expect(replacementIssued.status).toBe(201);
    expect(replacement.status).toBe(202);
  });

  it('keeps an active workspace when abort fails and retries on the next sweep', async () => {
    let currentTime = new Date('2026-08-08T00:00:00.000Z');
    const root = await createWorkspaceRoot();
    let tick: (() => void | Promise<void>) | undefined;
    let abortAttempts = 0;
    const warnings: unknown[] = [];
    const app = createApp({
      mode: 'public',
      workspaceRoot: root,
      idGenerator: () => 'abort-retry',
      now: () => new Date(currentTime),
      logger: {
        error: () => undefined,
        info: () => undefined,
        warn: (message) => { warnings.push(message); },
      },
      agentRun: () => ({
        completion: pendingRun(),
        abort: () => {
          abortAttempts += 1;
          if (abortAttempts === 1) {
            throw new Error('injected abort failure');
          }
        },
      }),
      intervalScheduler: {
        setInterval(callback) {
          tick = callback;
          return { unref: () => undefined };
        },
        clearInterval: () => undefined,
      },
    });
    createdApps.push(app);
    await request(app).post('/api/agent/sessions').send({});
    await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'abort-retry', task: 'work', mode: 'demo' });
    const workspace = join(root, 'abort-retry');

    currentTime = new Date('2026-08-08T01:00:00.000Z');
    await tick!();
    const workspaceAfterFailure = await realpath(workspace);
    await tick!();

    expect(workspaceAfterFailure).toBe(workspace);
    expect(abortAttempts).toBe(2);
    expect(warnings).toContain('SESSION_ABORT_FAILED');
    expect(warnings).toContain('SESSION_SWEEP_FAILED');
    await expect(realpath(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not let one failed active abort starve other expired cleanup', async () => {
    let currentTime = new Date('2026-08-08T00:00:00.000Z');
    const root = await createWorkspaceRoot();
    const ids = ['stuck-active', 'clean-active', 'inactive-expired'];
    const abortAttempts = new Map<string, number>();
    const warnings: unknown[] = [];
    const app = createApp({
      mode: 'public',
      workspaceRoot: root,
      idGenerator: () => ids.shift()!,
      now: () => new Date(currentTime),
      logger: {
        error: () => undefined,
        info: () => undefined,
        warn: (message) => { warnings.push(message); },
      },
      agentRun: ({ session }) => ({
        completion: pendingRun(),
        abort: async () => {
          abortAttempts.set(session.id, (abortAttempts.get(session.id) ?? 0) + 1);
          if (session.id === 'stuck-active') {
            throw new Error('permanent abort failure');
          }
        },
      }),
    });
    createdApps.push(app);
    await request(app).post('/api/agent/sessions').send({});
    await request(app).post('/api/agent/sessions').send({});
    await request(app).post('/api/agent/sessions').send({});
    await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'stuck-active', task: 'stuck', mode: 'demo' });
    await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'clean-active', task: 'clean', mode: 'demo' });

    currentTime = new Date('2026-08-08T01:00:00.000Z');
    await app.sweepSessions();

    expect(await realpath(join(root, 'stuck-active'))).toBe(join(root, 'stuck-active'));
    await expect(realpath(join(root, 'clean-active'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(realpath(join(root, 'inactive-expired'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(abortAttempts.get('stuck-active')).toBe(1);
    expect(abortAttempts.get('clean-active')).toBe(1);
    expect(warnings).toContain('SESSION_ABORT_FAILED');
    expect(warnings).toContain('SESSION_SWEEP_FAILED');
  });

  it('reports a failed sweep, retries on the next tick, and closes its timer', async () => {
    const root = await createWorkspaceRoot();
    const actualRegistry = createSessionRegistry({
      workspaceManager: createWorkspaceManager({ root }),
    });
    let sweepAttempts = 0;
    const registry: SessionRegistry = {
      ...actualRegistry,
      async sweepExpired() {
        sweepAttempts += 1;
        if (sweepAttempts === 1) {
          throw new Error('injected sweep failure');
        }
        return 0;
      },
    };
    let tick: (() => void | Promise<void>) | undefined;
    let cleared = false;
    let unrefCalled = false;
    const warnings: unknown[] = [];
    const app = createApp({
      mode: 'public',
      sessionRegistry: registry,
      intervalScheduler: {
        setInterval(callback) {
          tick = callback;
          return { unref: () => { unrefCalled = true; } };
        },
        clearInterval() {
          cleared = true;
        },
      },
      logger: {
        error: () => undefined,
        info: () => undefined,
        warn: (value) => { warnings.push(value); },
      },
    });
    createdApps.push(app);

    expect(tick).toBeDefined();
    await tick!();
    await tick!();
    app.close();

    expect(sweepAttempts).toBe(2);
    expect(warnings).toEqual(['SESSION_SWEEP_FAILED']);
    expect(unrefCalled).toBe(true);
    expect(cleared).toBe(true);
  });

  it('runs sweeps single-flight and close waits while preventing later ticks', async () => {
    const root = await createWorkspaceRoot();
    const actualRegistry = createSessionRegistry({
      workspaceManager: createWorkspaceManager({ root }),
    });
    let releaseSweep!: () => void;
    const sweepGate = new Promise<void>((resolve) => { releaseSweep = resolve; });
    let sweepAttempts = 0;
    const registry: SessionRegistry = {
      ...actualRegistry,
      async sweepExpired() {
        sweepAttempts += 1;
        await sweepGate;
        return 0;
      },
    };
    let tick: (() => void | Promise<void>) | undefined;
    const app = createApp({
      mode: 'public',
      sessionRegistry: registry,
      intervalScheduler: {
        setInterval(callback) {
          tick = callback;
          return { unref: () => undefined };
        },
        clearInterval: () => undefined,
      },
    });
    createdApps.push(app);

    const first = Promise.resolve(tick!());
    const overlapping = Promise.resolve(tick!());
    await nextTurn();
    let closeSettled = false;
    const closePromise = Promise.resolve(app.close()).then(() => { closeSettled = true; });
    await nextTurn();
    const afterClose = Promise.resolve(tick!());
    await nextTurn();
    const attemptsWhileBlocked = sweepAttempts;
    const settledBeforeRelease = closeSettled;
    releaseSweep();
    await Promise.all([first, overlapping, afterClose, closePromise]);

    expect(attemptsWhileBlocked).toBe(1);
    expect(settledBeforeRelease).toBe(false);
    expect(closeSettled).toBe(true);
    expect(sweepAttempts).toBe(1);
  });

  it('applies deployment rate-limit overrides from the environment', async () => {
    vi.stubEnv('HARNESS_RUN_RATE_LIMIT', '1');
    vi.stubEnv('HARNESS_RUN_RATE_WINDOW_MS', '60000');
    const app = await createPublicApp();

    const first = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'missing', task: 'first', mode: 'demo' });
    const limited = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'missing', task: 'second', mode: 'demo' });

    expect(first.status).toBe(404);
    expect(limited.status).toBe(429);
  });

  it.each([
    ['invalid'],
    ['0'],
    ['-1'],
    ['2147483648'],
  ])('falls back safely for invalid rate-limit window %s', async (windowMs) => {
    vi.stubEnv('HARNESS_RUN_RATE_LIMIT', '1');
    vi.stubEnv('HARNESS_RUN_RATE_WINDOW_MS', windowMs);
    const app = await createPublicApp();

    const first = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'missing', task: 'first', mode: 'demo' });
    const limited = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'missing', task: 'second', mode: 'demo' });

    expect(first.status).toBe(404);
    expect(limited.status).toBe(429);
  });

  it('applies the deployment concurrency override from the environment', async () => {
    vi.stubEnv('HARNESS_MAX_CONCURRENT_RUNS', '1');
    const ids = ['environment-first', 'environment-second'];
    const app = await createPublicApp({ idGenerator: () => ids.shift()! });
    await request(app).post('/api/agent/sessions').send({});
    await request(app).post('/api/agent/sessions').send({});

    await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'environment-first', task: 'first', mode: 'demo' });
    const limited = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'environment-second', task: 'second', mode: 'demo' });

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: 'CONCURRENT_RUN_LIMIT' });
  });

  it('does not expose persistent session-list routes in public mode', async () => {
    const app = await createPublicApp();

    const response = await request(app).get('/api/sessions');

    expect(response.status).toBe(404);
  });
});
