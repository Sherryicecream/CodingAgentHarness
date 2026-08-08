import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session, SessionStore } from '@harness/core';
import { createApp, type HarnessApp } from '../../src/app.js';
import type { CredentialStore } from '../../src/credential-store.js';

const temporaryPaths: string[] = [];
const apps: HarnessApp[] = [];

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'harness-history-policy-'));
  temporaryPaths.push(root);
  return root;
};

const emptyCredentials: CredentialStore = {
  hasKey: () => false,
  getKey: () => null,
  setKey: () => undefined,
  deleteKey: () => undefined,
  listServices: () => [],
};

const completedSession: Session = {
  id: 'persisted-agent-session',
  createdAt: new Date('2026-08-08T00:01:00.000Z'),
  task: 'local task',
  messages: [],
  toolCalls: [],
  feedbackRuns: [],
  status: 'completed',
  conclusion: null,
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

describe('session history policy', () => {
  it('persists completed local runs and exposes them through local history', async () => {
    const sessions = new Map<string, Session>();
    const sessionStore: SessionStore = {
      async save(session) { sessions.set(session.id, session); },
      async load(id) { return sessions.get(id) ?? null; },
      async list() { return [...sessions.values()]; },
      async delete(id) { sessions.delete(id); },
    };
    const app = createApp({
      mode: 'local',
      workspaceRoot: await createRoot(),
      idGenerator: () => 'local-public-session',
      credentialStore: emptyCredentials,
      sessionStore,
      agentRun: async () => ({
        status: 'completed',
        sessionId: completedSession.id,
        session: completedSession,
      }),
    });
    apps.push(app);
    await request(app).post('/api/agent/sessions').send({});

    const started = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'local-public-session', task: 'work', mode: 'server' });
    await vi.waitFor(() => expect(sessions.size).toBe(1));
    const history = await request(app).get('/api/sessions');

    expect(started.status).toBe(202);
    expect(history.status).toBe(200);
    expect(history.body.sessions).toHaveLength(1);
    expect(history.body.sessions[0]).toMatchObject({
      id: 'persisted-agent-session',
      task: 'local task',
      status: 'completed',
    });
  });

  it('never touches a persistent session store in public mode', async () => {
    const forbiddenStore: SessionStore = {
      save: async () => { throw new Error('public save forbidden'); },
      load: async () => { throw new Error('public load forbidden'); },
      list: async () => { throw new Error('public list forbidden'); },
      delete: async () => { throw new Error('public delete forbidden'); },
    };
    const app = createApp({
      mode: 'public',
      workspaceRoot: await createRoot(),
      idGenerator: () => 'public-no-history',
      sessionStore: forbiddenStore,
      agentRun: async () => ({
        status: 'completed',
        session: completedSession,
      }),
    });
    apps.push(app);
    await request(app).post('/api/agent/sessions').send({});

    const started = await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'public-no-history', task: 'work', mode: 'demo' });
    const history = await request(app).get('/api/sessions');

    expect(started.status).toBe(202);
    expect(history.status).toBe(404);
  });

  it('persists the terminal result produced by an approved continuation', async () => {
    const sessions = new Map<string, Session>();
    const sessionStore: SessionStore = {
      async save(session) { sessions.set(session.id, session); },
      async load(id) { return sessions.get(id) ?? null; },
      async list() { return [...sessions.values()]; },
      async delete(id) { sessions.delete(id); },
    };
    const app = createApp({
      mode: 'local',
      workspaceRoot: await createRoot(),
      idGenerator: () => 'approved-history',
      credentialStore: emptyCredentials,
      sessionStore,
      agentRun: () => ({
        completion: Promise.resolve({ status: 'blocked' }),
        continueAfterApproval: async () => ({
          status: 'completed',
          sessionId: completedSession.id,
          session: completedSession,
        }),
      }),
    });
    apps.push(app);
    await request(app).post('/api/agent/sessions').send({});
    await request(app)
      .post('/api/agent/run')
      .send({ sessionId: 'approved-history', task: 'work', mode: 'server' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const approved = await request(app)
      .post('/api/agent/approve')
      .send({ sessionId: 'approved-history' });
    expect(approved.status).toBe(200);
    await vi.waitFor(() => expect(sessions.size).toBe(1));

    const history = await request(app).get('/api/sessions');
    expect(history.body.sessions[0]).toMatchObject({
      id: completedSession.id,
      status: 'completed',
    });
  });
});
