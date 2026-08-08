import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { CredentialStore } from '../../src/credential-store.js';

const throwingStore = (): CredentialStore => ({
  hasKey: () => { throw new Error('credential store must not be called'); },
  getKey: () => { throw new Error('credential store must not be called'); },
  setKey: () => { throw new Error('credential store must not be called'); },
  deleteKey: () => { throw new Error('credential store must not be called'); },
  listServices: () => { throw new Error('credential store must not be called'); },
});

describe('configuration policy boundary', () => {
  it.each([
    ['get', '/api/config/status'],
    ['post', '/api/config/key'],
    ['delete', '/api/config/key'],
    ['get', '/api/config/guide'],
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
    const store: CredentialStore = {
      hasKey: (service) => values.has(service),
      getKey: (service) => values.get(service) ?? null,
      setKey: (service, key) => { values.set(service, key); },
      deleteKey: (service) => { values.delete(service); },
      listServices: () => [...values.keys()],
    };
    const app = createApp({ mode: 'local', credentialStore: store });

    const saved = await request(app).post('/api/config/key').send({ key: 'sk-local-value' });
    const status = await request(app).get('/api/config/status');
    const removed = await request(app).delete('/api/config/key');

    expect(saved.status).toBe(200);
    expect(status.body).toEqual({ hasKey: true, source: 'file' });
    expect(removed.status).toBe(200);
    expect(values.size).toBe(0);
  });
});
