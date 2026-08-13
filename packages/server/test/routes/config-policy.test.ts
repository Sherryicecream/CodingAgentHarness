import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { CredentialStore } from '../../src/credential-store.js';
import { createConfigRouter } from '../../src/routes/config.js';
import { LOCAL_RUNTIME_POLICY, PUBLIC_RUNTIME_POLICY } from '../../src/security/runtime-policy.js';

const createStore = (): CredentialStore => ({
  status: () => ({ storage: 'keyring', hasKey: false }),
  getKey: () => null,
  setKey: vi.fn(),
  deleteKey: vi.fn(() => true),
});

const appFor = (credentialStore: CredentialStore, local = true) => {
  const app = express();
  app.use(express.json());
  app.use('/api/config', createConfigRouter({
    policy: local ? LOCAL_RUNTIME_POLICY : PUBLIC_RUNTIME_POLICY,
    credentialStore,
  }));
  return app;
};

describe('credential configuration policy', () => {
  it('rejects every credential operation in public mode', async () => {
    const app = appFor(createStore(), false);
    await request(app).get('/api/config/status').expect(403, { error: 'CONFIG_DISABLED' });
    await request(app).put('/api/config/key').send({ key: 'sk-test-never-used' }).expect(403);
    await request(app).delete('/api/config/key').expect(403);
  });

  it('stores and deletes a key without returning it', async () => {
    const store = createStore();
    const app = appFor(store);
    const key = 'sk-test-keyring-only';
    const saved = await request(app).put('/api/config/key').send({ key }).expect(200);
    expect(JSON.stringify(saved.body)).not.toContain(key);
    expect(store.setKey).toHaveBeenCalledWith(key);
    await request(app).delete('/api/config/key').expect(200);
    expect(store.deleteKey).toHaveBeenCalledOnce();
  });

  it('reports keyring unavailability without exposing an exception', async () => {
    const store = createStore();
    store.setKey = () => { throw new Error('native detail'); };
    await request(appFor(store)).put('/api/config/key')
      .send({ key: 'sk-test-keyring-only' })
      .expect(503, { error: 'KEYRING_UNAVAILABLE' });
  });
});
