import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type AppOptions } from '../../src/app.js';

const temporaryPaths: string[] = [];

const createWorkspaceRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'harness-public-routes-'));
  temporaryPaths.push(root);
  return root;
};

const pendingRun = (): Promise<never> => new Promise(() => undefined);

const createPublicApp = async (overrides: Partial<AppOptions> = {}) => createApp({
  mode: 'public',
  workspaceRoot: await createWorkspaceRoot(),
  agentRun: pendingRun,
  ...overrides,
});

afterEach(async () => {
  vi.unstubAllEnvs();
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
    expect(response.body).toEqual({
      sessionId: 'server-issued-session',
      mode: 'public',
      capabilities: {
        allowedExperiences: ['demo', 'byok'],
        allowByok: true,
        allowProcessTools: false,
        allowServerCredentials: false,
      },
      expiresAt: '2026-08-08T01:00:00.000Z',
    });
    expect(response.body).not.toHaveProperty('workspace');
    expect(response.body).not.toHaveProperty('clientKey');
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

  it('rejects experience modes that are not allowed by the effective policy', async () => {
    const app = await createPublicApp({ idGenerator: () => 'policy-session' });
    await request(app).post('/api/agent/sessions').send({});

    const response = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'policy-session', task: 'work', mode: 'server' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'EXPERIENCE_NOT_ALLOWED' });
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
