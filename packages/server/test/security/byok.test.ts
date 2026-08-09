import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMAdapter, Session, SessionStore } from '@harness/core';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type AppOptions, type HarnessApp } from '../../src/app.js';
import type { CredentialStore } from '../../src/credential-store.js';
import { createDefaultAgentRun } from '../../src/routes/agent.js';
import { isSecureByokRequest } from '../../src/security/request-security.js';
import { redactSecrets } from '../../src/security/secret-redactor.js';
import { PUBLIC_RUNTIME_POLICY } from '../../src/security/runtime-policy.js';
import type { SSEEvent, SSEManager } from '../../src/sse/sse-manager.js';

const SENTINEL = 'sk-test-byok-sentinel';
const temporaryPaths: string[] = [];
const apps: HarnessApp[] = [];

const emptyCredentialStore: CredentialStore = {
  hasKey: () => false,
  getKey: () => null,
  setKey: () => undefined,
  deleteKey: () => undefined,
  listServices: () => [],
};

const emptySessionStore: SessionStore = {
  save: async () => undefined,
  load: async () => null,
  list: async () => [],
  delete: async () => undefined,
};

const createTestApp = async (options: Partial<AppOptions> = {}): Promise<HarnessApp> => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'harness-byok-'));
  temporaryPaths.push(workspaceRoot);
  const app = createApp({
    mode: 'local',
    workspaceRoot,
    idGenerator: () => 'byok-session',
    credentialStore: emptyCredentialStore,
    sessionStore: emptySessionStore,
    ...options,
  });
  apps.push(app);
  return app;
};

const completingAdapter: LLMAdapter = {
  sendMessage: async () => ({ content: 'Task completed.', toolCalls: [] }),
};

const waitForAsyncCompletion = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const settleWithin = async <T>(
  promise: Promise<T>,
  timeoutMs = 250,
): Promise<'settled' | 'timeout'> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(() => 'settled' as const),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const createTrackingSSEManager = () => {
  const events: SSEEvent[] = [];
  const secretSessions = new Map<string, readonly string[]>();
  const closedSessions = new Set<string>();
  const manager: SSEManager = {
    createConnection: () => undefined,
    disconnect: () => undefined,
    setSecrets: (sessionId, secrets) => { secretSessions.set(sessionId, [...secrets]); },
    clearSecrets: (sessionId) => { secretSessions.delete(sessionId); },
    push: (sessionId, event) => {
      events.push({
        ...event,
        data: redactSecrets(event.data, secretSessions.get(sessionId) ?? []),
      });
    },
    close: (sessionId) => {
      secretSessions.delete(sessionId);
      closedSessions.add(sessionId);
    },
  };
  return { manager, events, secretSessions, closedSessions };
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('BYOK request security', () => {
  it.each([
    { sessionId: 'byok-session', task: 'work', mode: 'byok' },
    { sessionId: 'byok-session', task: 'work', mode: 'byok', apiKey: '' },
    { sessionId: 'byok-session', task: 'work', mode: 'demo', apiKey: SENTINEL },
  ])('rejects credentials that do not match the selected experience', async (body) => {
    vi.stubEnv('NODE_ENV', 'test');
    const app = await createTestApp();
    await request(app).post('/api/agent/sessions').send({});

    const response = await request(app).post('/api/agent/run').send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'INVALID_RUN_REQUEST' });
    expect(JSON.stringify(response.body)).not.toContain(SENTINEL);
  });

  it('rejects non-demo requests in public mode with a stable policy error', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const app = await createTestApp({ mode: 'public', trustProxy: 1 });
    await request(app)
      .post('/api/agent/sessions')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({});

    const response = await request(app)
      .post('/api/agent/run')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({ sessionId: 'byok-session', task: 'work', mode: 'byok', apiKey: SENTINEL });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'EXPERIENCE_NOT_ALLOWED' });
    expect(JSON.stringify(response.body)).not.toContain(SENTINEL);
  });

  it('accepts HTTPS reported through one trusted proxy hop', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const app = await createTestApp({
      trustProxy: 1,
      byokAdapterFactory: () => ({ adapter: completingAdapter }),
    });
    await request(app)
      .post('/api/agent/sessions')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({});

    const response = await request(app)
      .post('/api/agent/run')
      .set('X-Forwarded-For', '203.0.113.10')
      .set('X-Forwarded-Proto', 'https')
      .send({ sessionId: 'byok-session', task: 'work', mode: 'byok', apiKey: SENTINEL });

    expect(response.status).toBe(202);
  });

  it('accepts direct loopback HTTP in development and keeps demo usable over external HTTP', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const loopback = await createTestApp({
      byokAdapterFactory: () => ({ adapter: completingAdapter }),
    });
    await request(loopback).post('/api/agent/sessions').send({});
    const byok = await request(loopback)
      .post('/api/agent/run')
      .send({ sessionId: 'byok-session', task: 'work', mode: 'byok', apiKey: SENTINEL });

    const demo = await createTestApp({
      idGenerator: () => 'demo-session',
      trustProxy: 1,
      agentRun: () => new Promise(() => undefined),
    });
    await request(demo)
      .post('/api/agent/sessions')
      .set('X-Forwarded-For', '203.0.113.11')
      .send({});
    const demoResponse = await request(demo)
      .post('/api/agent/run')
      .set('X-Forwarded-For', '203.0.113.11')
      .send({ sessionId: 'demo-session', task: 'show me', mode: 'demo' });

    expect(byok.status).toBe(202);
    expect(demoResponse.status).toBe(202);
  });

  it('does not independently trust a forwarded-proto header', () => {
    const requestLike = {
      secure: false,
      ip: '203.0.113.12',
      headers: { 'x-forwarded-proto': 'https' },
    };

    expect(isSecureByokRequest(requestLike as never)).toBe(false);
  });

  it('releases BYOK resources and redacts persisted session data after success', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    let released = false;
    let saved = '';
    let savedCreatedAt = '';
    const sessionStore: SessionStore = {
      save: async (session: Session) => {
        savedCreatedAt = session.createdAt.toISOString();
        saved = JSON.stringify(session);
      },
      list: async () => [],
      load: async () => null,
      delete: async () => undefined,
    };
    const echoingAdapter: LLMAdapter = {
      sendMessage: async () => ({
        content: `Task completed. Provider echoed ${SENTINEL}`,
        toolCalls: [],
      }),
    };
    const app = await createTestApp({
      mode: 'local',
      credentialStore: emptyCredentialStore,
      sessionStore,
      byokAdapterFactory: () => ({
        adapter: echoingAdapter,
        release: () => { released = true; },
      }),
    });
    await request(app).post('/api/agent/sessions').send({});

    const response = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'byok-session', task: 'work', mode: 'byok', apiKey: SENTINEL });
    await vi.waitFor(() => expect(released).toBe(true));

    expect(response.status).toBe(202);
    expect(saved).not.toContain(SENTINEL);
    expect(saved).toContain('[REDACTED]');
    expect(savedCreatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(released).toBe(true);
  });

  it('keeps a successful run completed when optional history persistence fails', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const sse = createTrackingSSEManager();
    const warnings: unknown[] = [];
    const app = await createTestApp({
      mode: 'local',
      credentialStore: emptyCredentialStore,
      sessionStore: {
        save: async () => { throw new Error('history unavailable'); },
        list: async () => [],
        load: async () => null,
        delete: async () => undefined,
      },
      byokAdapterFactory: () => ({ adapter: completingAdapter }),
      sseManager: sse.manager,
      logger: {
        error: () => undefined,
        info: () => undefined,
        warn: (message) => { warnings.push(message); },
      },
    });
    await request(app).post('/api/agent/sessions').send({});

    await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'byok-session', task: 'work', mode: 'byok', apiKey: SENTINEL });
    await vi.waitFor(() => expect(warnings).toContain('SESSION_HISTORY_SAVE_FAILED'));

    expect(warnings).toContain('SESSION_HISTORY_SAVE_FAILED');
    expect(sse.events.some((event) => (
      event.type === 'complete' && (event.data as { status?: string }).status === 'completed'
    ))).toBe(true);
    expect(sse.events.some((event) => event.type === 'error')).toBe(false);
  });

  it('sanitizes an upstream failure to a stable code and safe status metadata', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const events: unknown[] = [];
    const warnings: unknown[] = [];
    let released = false;
    const providerError = Object.assign(
      new Error(`provider rejected ${SENTINEL}`),
      { statusCode: 401, responseBody: `{"credential":"${SENTINEL}"}` },
    );
    const app = await createTestApp({
      byokAdapterFactory: () => ({
        adapter: { sendMessage: async () => { throw providerError; } },
        release: () => { released = true; },
      }),
      sseManager: {
        createConnection: () => undefined,
        disconnect: () => undefined,
        setSecrets: () => undefined,
        clearSecrets: () => undefined,
        push: (_sessionId, event) => { events.push(event); },
        close: () => undefined,
      },
      logger: {
        error: () => undefined,
        info: () => undefined,
        warn: (message) => { warnings.push(message); },
      },
    });
    await request(app).post('/api/agent/sessions').send({});

    const response = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'byok-session', task: 'work', mode: 'byok', apiKey: SENTINEL });
    await vi.waitFor(() => expect(released).toBe(true));
    const serialized = JSON.stringify({ response: response.body, events, warnings });

    expect(response.status).toBe(202);
    expect(serialized).not.toContain(SENTINEL);
    expect(serialized).not.toContain('responseBody');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      data: { error: 'LLM_PROVIDER_ERROR', status: 401 },
    }));
    expect(released).toBe(true);
  });

  it('replaces the provider rejection before exposing the run completion promise', async () => {
    const providerError = Object.assign(
      new Error(`provider failed with ${SENTINEL}`),
      { statusCode: 503, responseBody: `body ${SENTINEL}` },
    );
    const run = createDefaultAgentRun({
      policy: PUBLIC_RUNTIME_POLICY,
      credentialStore: emptyCredentialStore,
      byokAdapterFactory: () => ({
        adapter: { sendMessage: async () => { throw providerError; } },
      }),
    });
    const started = run({
      session: {
        id: 'direct-run',
        clientKey: 'loopback',
        workspace: temporaryPaths[0] ?? process.cwd(),
        status: 'running',
        createdAt: new Date('2026-08-08T00:00:00.000Z'),
        expiresAt: new Date('2026-08-08T01:00:00.000Z'),
      },
      task: 'work',
      mode: 'byok',
      apiKey: SENTINEL,
      emit: () => undefined,
    });
    const handle = 'completion' in started ? started : { completion: started };

    const exposedError = await handle.completion.catch((error: unknown) => error);
    handle.release?.();
    const serialized = JSON.stringify(exposedError, Object.getOwnPropertyNames(exposedError));

    expect(exposedError).toMatchObject({
      name: 'LLMProviderError',
      message: 'LLM_PROVIDER_ERROR',
      statusCode: 503,
    });
    expect(serialized).not.toContain(SENTINEL);
    expect(serialized).not.toContain('responseBody');
    expect(exposedError).not.toHaveProperty('cause');
  });

  it.each(['resolve', 'reject'] as const)(
    'expires a BYOK run whose provider ignores abort, then ignores its late %s',
    async (lateSettlement) => {
      vi.stubEnv('NODE_ENV', 'test');
      let currentTime = new Date('2026-08-08T00:00:00.000Z');
      let signal: AbortSignal | undefined;
      let resolveProvider!: (value: Awaited<ReturnType<LLMAdapter['sendMessage']>>) => void;
      let rejectProvider!: (error: Error) => void;
      const provider = new Promise<Awaited<ReturnType<LLMAdapter['sendMessage']>>>(
        (resolve, reject) => {
          resolveProvider = resolve;
          rejectProvider = reject;
        },
      );
      let released = false;
      const sse = createTrackingSSEManager();
      const ids = ['hung-byok', 'replacement'];
      const app = await createTestApp({
        now: () => new Date(currentTime),
        idGenerator: () => ids.shift()!,
        maxConcurrent: 1,
        abortTimeoutMs: 10,
        byokAdapterFactory: () => ({
          adapter: {
            sendMessage: (_context, abortSignal) => {
              signal = abortSignal;
              return provider;
            },
          },
          release: () => { released = true; },
        }),
        sseManager: sse.manager,
      });
      const root = temporaryPaths.at(-1)!;
      await request(app).post('/api/agent/sessions').send({});
      await request(app)
        .post('/api/agent/run')
        .send({ sessionId: 'hung-byok', task: 'work', mode: 'byok', apiKey: SENTINEL });

      currentTime = new Date('2026-08-08T01:00:00.000Z');
      const sweep = app.sweepSessions();
      const sweepOutcome = await settleWithin(sweep);
      if (sweepOutcome === 'timeout') {
        rejectProvider(new Error('test cleanup after hung sweep'));
        await sweep;
      }

      expect(sweepOutcome).toBe('settled');
      expect(signal?.aborted).toBe(true);
      expect(released).toBe(true);
      expect(sse.secretSessions.size).toBe(0);
      expect(sse.closedSessions).toContain('hung-byok');
      await expect(import('node:fs/promises').then(({ realpath }) => (
        realpath(join(root, 'hung-byok'))
      ))).rejects.toMatchObject({ code: 'ENOENT' });

      const eventCountAtCleanup = sse.events.length;
      if (sweepOutcome === 'settled') {
        if (lateSettlement === 'resolve') {
          resolveProvider({
            content: `TASK_COMPLETE ${SENTINEL}`,
            toolCalls: [{
              id: 'late-write',
              name: 'write_file',
              arguments: { path: 'late.txt', content: SENTINEL },
            }],
          });
        } else {
          rejectProvider(new Error(`late rejection ${SENTINEL}`));
        }
        await waitForAsyncCompletion();
      }
      expect(sse.events).toHaveLength(eventCountAtCleanup);
      await expect(import('node:fs/promises').then(({ realpath }) => (
        realpath(join(root, 'hung-byok', 'late.txt'))
      ))).rejects.toMatchObject({ code: 'ENOENT' });

      const expired = await request(app)
        .post('/api/agent/run')
        .send({ sessionId: 'hung-byok', task: 'again', mode: 'demo' });
      const issued = await request(app).post('/api/agent/sessions').send({});
      const replacement = await request(app)
        .post('/api/agent/run')
        .send({ sessionId: 'replacement', task: 'replacement', mode: 'demo' });
      expect(expired.status).toBe(404);
      expect(issued.status).toBe(201);
      expect(replacement.status).toBe(202);
    },
  );

  it('bounds an injected abort that never settles and observes its later rejection', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    let currentTime = new Date('2026-08-08T00:00:00.000Z');
    let rejectAbort!: (error: Error) => void;
    const abort = new Promise<void>((_resolve, reject) => { rejectAbort = reject; });
    const completion = new Promise<never>(() => undefined);
    let released = false;
    const sse = createTrackingSSEManager();
    const app = await createTestApp({
      now: () => new Date(currentTime),
      abortTimeoutMs: 10,
      agentRun: () => ({
        completion,
        abort: () => abort,
        release: () => { released = true; },
      }),
      sseManager: sse.manager,
    });
    const root = temporaryPaths.at(-1)!;
    await request(app).post('/api/agent/sessions').send({});
    await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'byok-session', task: 'work', mode: 'byok', apiKey: SENTINEL });

    currentTime = new Date('2026-08-08T01:00:00.000Z');
    const sweep = app.sweepSessions();
    const sweepOutcome = await settleWithin(sweep);
    rejectAbort(new Error(`late abort rejection ${SENTINEL}`));
    if (sweepOutcome === 'timeout') {
      await sweep;
    }
    await waitForAsyncCompletion();

    expect(sweepOutcome).toBe('settled');
    expect(released).toBe(true);
    expect(sse.secretSessions.size).toBe(0);
    await expect(import('node:fs/promises').then(({ realpath }) => (
      realpath(join(root, 'byok-session'))
    ))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('forwards AgentLoop abort through the production BYOK wrapper and clears request headers', async () => {
    let capturedSignal: AbortSignal | undefined;
    let capturedHeaders: HeadersInit | undefined;
    let resolveFetch!: (response: Response) => void;
    const fetchResult = new Promise<Response>((resolve, reject) => {
      resolveFetch = resolve;
      vi.stubGlobal('fetch', ((_url: string | URL, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        capturedHeaders = init?.headers;
        capturedSignal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
        return fetchResult;
      }) as typeof fetch);
    });
    const run = createDefaultAgentRun({
      policy: PUBLIC_RUNTIME_POLICY,
      credentialStore: emptyCredentialStore,
    });
    const started = run({
      session: {
        id: 'default-wrapper',
        clientKey: 'loopback',
        workspace: process.cwd(),
        status: 'running',
        createdAt: new Date('2026-08-08T00:00:00.000Z'),
        expiresAt: new Date('2026-08-08T01:00:00.000Z'),
      },
      task: 'work',
      mode: 'byok',
      apiKey: SENTINEL,
      emit: () => undefined,
    });
    const handle = 'completion' in started ? started : { completion: started };
    await waitForAsyncCompletion();

    await handle.abort?.();
    const outcome = await settleWithin(handle.completion.catch(() => undefined));
    if (outcome === 'timeout') {
      resolveFetch(new Response(JSON.stringify({
        choices: [{ message: { content: 'TASK_COMPLETE' } }],
      }), { status: 200 }));
      await handle.completion.catch(() => undefined);
    }
    handle.release?.();

    expect(outcome).toBe('settled');
    expect(capturedSignal?.aborted).toBe(true);
    expect(JSON.stringify(capturedHeaders)).not.toContain(SENTINEL);
  });

  it('cleans terminal BYOK state before a pending history save settles', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    let currentTime = new Date('2026-08-08T00:00:00.000Z');
    let rejectSave!: (error: Error) => void;
    const pendingSave = new Promise<void>((_resolve, reject) => { rejectSave = reject; });
    let savedSnapshot = '';
    let savedCreatedAt = '';
    let saveCalls = 0;
    let released = false;
    const warnings: unknown[] = [];
    const sse = createTrackingSSEManager();
    const ids = ['save-pending', 'replacement-after-save'];
    const app = await createTestApp({
      mode: 'local',
      credentialStore: emptyCredentialStore,
      now: () => new Date(currentTime),
      idGenerator: () => ids.shift()!,
      maxConcurrent: 1,
      historySaveTimeoutMs: 10,
      sessionStore: {
        save: (session) => {
          saveCalls += 1;
          if (saveCalls === 1) {
            savedCreatedAt = session.createdAt.toISOString();
            savedSnapshot = JSON.stringify(session);
            return pendingSave;
          }
          return Promise.resolve();
        },
        list: async () => [],
        load: async () => null,
        delete: async () => undefined,
      },
      byokAdapterFactory: () => ({
        adapter: {
          sendMessage: async () => ({
            content: `TASK_COMPLETE ${SENTINEL}`,
            toolCalls: [],
          }),
        },
        release: () => { released = true; },
      }),
      sseManager: sse.manager,
      logger: {
        error: () => undefined,
        info: () => undefined,
        warn: (message) => { warnings.push(message); },
      },
    });
    const root = temporaryPaths.at(-1)!;
    await request(app).post('/api/agent/sessions').send({});
    await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'save-pending', task: 'work', mode: 'byok', apiKey: SENTINEL });
    await waitForAsyncCompletion();
    await waitForAsyncCompletion();

    const releasedBeforeSaveSettled = released;
    const secretsBeforeSaveSettled = sse.secretSessions.size;
    const issued = await request(app).post('/api/agent/sessions').send({});
    const replacement = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'replacement-after-save', task: 'replacement', mode: 'demo' });
    currentTime = new Date('2026-08-08T01:00:00.000Z');
    await app.sweepSessions();
    let workspaceRemovedBeforeSaveSettled = false;
    try {
      await import('node:fs/promises').then(({ realpath }) => (
        realpath(join(root, 'save-pending'))
      ));
    } catch {
      workspaceRemovedBeforeSaveSettled = true;
    }

    const eventCountBeforeLateReject = sse.events.length;
    rejectSave(new Error(`late history rejection ${SENTINEL}`));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await waitForAsyncCompletion();

    expect(releasedBeforeSaveSettled).toBe(true);
    expect(secretsBeforeSaveSettled).toBe(0);
    expect(issued.status).toBe(201);
    expect(replacement.status).toBe(202);
    expect(workspaceRemovedBeforeSaveSettled).toBe(true);
    expect(savedCreatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(savedSnapshot).toContain('[REDACTED]');
    expect(savedSnapshot).not.toContain(SENTINEL);
    expect(JSON.stringify({ warnings, events: sse.events })).not.toContain(SENTINEL);
    expect(sse.events.slice(eventCountBeforeLateReject)).toEqual([]);
  });

  it('drops tool events emitted after forced terminal cleanup', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    let currentTime = new Date('2026-08-08T00:00:00.000Z');
    let lateEmit!: (type: SSEEvent['type'], data: unknown) => void;
    let released = false;
    const sse = createTrackingSSEManager();
    const app = await createTestApp({
      now: () => new Date(currentTime),
      agentRun: ({ emit }) => {
        lateEmit = emit;
        return {
          completion: new Promise<never>(() => undefined),
          abort: () => undefined,
          release: () => { released = true; },
        };
      },
      sseManager: sse.manager,
    });
    await request(app).post('/api/agent/sessions').send({});
    await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'byok-session', task: 'work', mode: 'byok', apiKey: SENTINEL });

    currentTime = new Date('2026-08-08T01:00:00.000Z');
    await app.sweepSessions();
    const eventCountAtCleanup = sse.events.length;
    lateEmit('tool_call', {
      status: 'done',
      result: { success: true, output: SENTINEL },
    });
    await waitForAsyncCompletion();

    expect(released).toBe(true);
    expect(sse.secretSessions.size).toBe(0);
    expect(sse.events).toHaveLength(eventCountAtCleanup);
    expect(JSON.stringify(sse.events)).not.toContain(SENTINEL);
  });
});
