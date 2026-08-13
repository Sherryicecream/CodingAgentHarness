import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { SessionStore } from '@harness/core';
import { createApp } from '../../src/app.js';
import type { CredentialStore } from '../../src/credential-store.js';

const throwingStore = (): CredentialStore => ({
  getState: () => 'empty',
  unlock: () => false,
  lock: () => undefined,
  initialize: () => undefined,
  hasKey: () => { throw new Error('credential store must not be called'); },
  getKey: () => { throw new Error('credential store must not be called'); },
  setKey: () => { throw new Error('credential store must not be called'); },
  deleteKey: () => { throw new Error('credential store must not be called'); },
  listServices: () => { throw new Error('credential store must not be called'); },
});

const emptySessionStore = (): SessionStore => ({
  save: async () => undefined,
  load: async () => null,
  list: async () => [],
  delete: async () => undefined,
});

describe('configuration policy boundary', () => {
  it.each([
    {
      label: 'credential store',
      dependencies: { sessionStore: emptySessionStore() },
    },
    {
      label: 'session store',
      dependencies: { credentialStore: throwingStore() },
    },
  ])('fails fast before scheduling work when local mode omits the $label', ({ dependencies }) => {
    const setInterval = vi.fn((): never => {
      throw new Error('INTERVAL_MUST_NOT_START');
    });

    expect(() => createApp({
      mode: 'local',
      ...dependencies,
      intervalScheduler: {
        setInterval,
        clearInterval: () => undefined,
      },
    })).toThrow(/local.*credential.*session|dependencies.*required/i);
    expect(setInterval).not.toHaveBeenCalled();
  });

  it.each([
    ['get', '/api/config/status'],
    ['post', '/api/config/key'],
    ['post', '/api/config/unlock'],
    ['post', '/api/config/lock'],
    ['delete', '/api/config/key'],
    ['get', '/api/config/guide'],
    ['get', '/api/config/providers'],
    ['post', '/api/config/providers'],
    ['delete', '/api/config/providers/fake-provider'],
  ] as const)('returns 403 for public %s %s without touching credentials', async (method, path) => {
    const app = createApp({ mode: 'public', credentialStore: throwingStore() });

    const response = method === 'get'
      ? await request(app).get(path)
      : method === 'post'
      ? await request(app).post(path).send({ key: 'sk-test-value' })
        : await request(app).delete(path);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'CONFIG_DISABLED' });
  });

  it('keeps credential configuration reachable in local mode', async () => {
    const values = new Map<string, string>();
    let state: 'empty' | 'legacy' | 'locked' | 'unlocked' = 'empty';
    const store: CredentialStore = {
      getState: () => state,
      unlock: (password) => {
        if (password !== 'correct horse battery staple') return false;
        state = 'unlocked';
        return true;
      },
      lock: () => { state = 'locked'; },
      initialize: () => { state = 'unlocked'; },
      hasKey: (service) => values.has(service),
      getKey: (service) => values.get(service) ?? null,
      setKey: (service, key) => { values.set(service, key); },
      deleteKey: (service) => { values.delete(service); },
      listServices: () => [...values.keys()],
    };
    const app = createApp({
      mode: 'local',
      credentialStore: store,
      sessionStore: emptySessionStore(),
    });

    const initialized = await request(app).post('/api/config/key').send({
      key: 'sk-local-value',
      masterPassword: 'correct horse battery staple',
    });
    const status = await request(app).get('/api/config/status');
    const locked = await request(app).post('/api/config/lock');
    const blockedUpdate = await request(app).post('/api/config/key').send({ key: 'sk-new-value' });
    const badUnlock = await request(app).post('/api/config/unlock').send({ masterPassword: 'wrong password' });
    const unlocked = await request(app).post('/api/config/unlock').send({
      masterPassword: 'correct horse battery staple',
    });
    const noKeyValue = await request(app).get('/api/config/key-value');
    const removed = await request(app).delete('/api/config/key');

    expect(initialized.status).toBe(200);
    expect(status.body).toEqual({ hasKey: true, source: 'file', state: 'unlocked' });
    expect(locked.status).toBe(200);
    expect(blockedUpdate.status).toBe(423);
    expect(badUnlock.status).toBe(401);
    expect(unlocked.status).toBe(200);
    expect(noKeyValue.status).toBe(404);
    expect(removed.status).toBe(200);
    expect(values.size).toBe(0);
  });
});
