import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionStore } from '@harness/core';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type HarnessApp } from '../../src/app.js';
import { createCredentialStore } from '../../src/credential-store.js';

const MASTER_PASSWORD = 'correct horse battery staple';
const DEEPSEEK_SENTINEL = 'fake-deepseek-key-sentinel';
const PROVIDER_KEY_SENTINEL = 'fake-provider-key-sentinel';

const sandboxes: string[] = [];
const apps: HarnessApp[] = [];

const emptySessionStore = (): SessionStore => ({
  save: async () => undefined,
  load: async () => null,
  list: async () => [],
  delete: async () => undefined,
});

const makeLocalApp = () => {
  const directory = mkdtempSync(join(tmpdir(), 'harness-provider-config-'));
  const filePath = join(directory, 'credentials.enc');
  const app = createApp({
    mode: 'local',
    credentialStore: createCredentialStore({ filePath }),
    sessionStore: emptySessionStore(),
  });
  sandboxes.push(directory);
  apps.push(app);
  return { app, filePath };
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const directory of sandboxes.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('local provider configuration', () => {
  it('rejects non-DeepSeek provider ids and endpoints', async () => {
    const { app } = makeLocalApp();
    await request(app).post('/api/config/key').send({
      key: DEEPSEEK_SENTINEL,
      masterPassword: MASTER_PASSWORD,
    }).expect(200);

    const response = await request(app).post('/api/config/providers').send({
      id: 'openai',
      name: 'Other provider',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-test',
      apiKey: PROVIDER_KEY_SENTINEL,
    });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'INVALID_PROVIDER' });
  });

  it('adds, lists, and deletes a second encrypted provider without returning either key', async () => {
    const { app, filePath } = makeLocalApp();
    await request(app).post('/api/config/key').send({
      key: DEEPSEEK_SENTINEL,
      masterPassword: MASTER_PASSWORD,
    }).expect(200);

    const created = await request(app).post('/api/config/providers').send({
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: PROVIDER_KEY_SENTINEL,
    });
    const listed = await request(app).get('/api/config/providers');

    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      provider: {
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        hasApiKey: true,
      },
    });
    expect(listed.body).toEqual({ providers: [created.body.provider] });
    expect(JSON.stringify(created.body)).not.toContain(PROVIDER_KEY_SENTINEL);
    expect(JSON.stringify(listed.body)).not.toContain(PROVIDER_KEY_SENTINEL);
    expect(readFileSync(filePath, 'utf8')).not.toContain(DEEPSEEK_SENTINEL);
    expect(readFileSync(filePath, 'utf8')).not.toContain(PROVIDER_KEY_SENTINEL);

    await request(app).delete('/api/config/providers/deepseek').expect(200);
    await request(app).get('/api/config/providers').expect(200, { providers: [] });
    await request(app).get('/api/config/status').expect(200, {
      hasKey: true,
      source: 'file',
      state: 'unlocked',
    });
  });

  it.each([
    [{ id: '../escape', name: 'Fake', baseUrl: 'https://provider.invalid/v1', model: 'fake', apiKey: PROVIDER_KEY_SENTINEL }],
    [{ id: 'fake', name: '', baseUrl: 'https://provider.invalid/v1', model: 'fake', apiKey: PROVIDER_KEY_SENTINEL }],
    [{ id: 'fake', name: 'Fake', baseUrl: 'file:///tmp/provider', model: 'fake', apiKey: PROVIDER_KEY_SENTINEL }],
    [{ id: 'fake', name: 'Fake', baseUrl: 'https://user:pass@provider.invalid/v1', model: 'fake', apiKey: PROVIDER_KEY_SENTINEL }],
    [{ id: 'fake', name: 'Fake', baseUrl: 'https://provider.invalid/v1?token=unsafe', model: 'fake', apiKey: PROVIDER_KEY_SENTINEL }],
    [{ id: 'fake', name: 'Fake', baseUrl: 'https://provider.invalid/v1', model: '\u0000fake', apiKey: PROVIDER_KEY_SENTINEL }],
    [{ id: 'fake', name: 'Fake', baseUrl: 'https://provider.invalid/v1', model: 'fake', apiKey: '' }],
  ])('rejects malformed or unsafe provider input %#', async (provider) => {
    const { app } = makeLocalApp();
    const response = await request(app).post('/api/config/providers').send({
      ...provider,
      masterPassword: MASTER_PASSWORD,
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'INVALID_PROVIDER' });
  });
});
