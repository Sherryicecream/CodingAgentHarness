import request from 'supertest';
import { createApp } from '../src/app.js';

it('creates an app without opening a network listener', async () => {
  const response = await request(createApp({ mode: 'public' })).get('/api/health');

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok', mode: 'public' });
});
