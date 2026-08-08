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
import { PUBLIC_RUNTIME_POLICY } from '../../src/security/runtime-policy.js';

const SENTINEL = 'sk-test-byok-sentinel';
const temporaryPaths: string[] = [];
const apps: HarnessApp[] = [];

const createTestApp = async (options: Partial<AppOptions> = {}): Promise<HarnessApp> => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'harness-byok-'));
  temporaryPaths.push(workspaceRoot);
  const app = createApp({
    mode: 'public',
    workspaceRoot,
    idGenerator: () => 'byok-session',
    ...options,
  });
  apps.push(app);
  return app;
};

const completingAdapter: LLMAdapter = {
  sendMessage: async () => ({ content: 'Task completed.', toolCalls: [] }),
};

const emptyCredentialStore: CredentialStore = {
  hasKey: () => false,
  getKey: () => null,
  setKey: () => undefined,
  deleteKey: () => undefined,
  listServices: () => [],
};

const waitForAsyncCompletion = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
  vi.unstubAllEnvs();
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

  it('rejects public BYOK over external HTTP with a stable safe error', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const app = await createTestApp({ trustProxy: 1 });
    await request(app)
      .post('/api/agent/sessions')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({});

    const response = await request(app)
      .post('/api/agent/run')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({ sessionId: 'byok-session', task: 'work', mode: 'byok', apiKey: SENTINEL });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'BYOK_REQUIRES_HTTPS' });
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
    const sessionStore: SessionStore = {
      save: async (session: Session) => { saved = JSON.stringify(session); },
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
    await waitForAsyncCompletion();

    expect(response.status).toBe(202);
    expect(saved).not.toContain(SENTINEL);
    expect(saved).toContain('[REDACTED]');
    expect(released).toBe(true);
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
    await waitForAsyncCompletion();
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
});
