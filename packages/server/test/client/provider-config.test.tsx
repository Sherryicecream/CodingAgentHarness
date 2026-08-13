// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfigPage } from '../../client/src/components/ConfigPage.js';

const jsonResponse = (body: unknown, status = 200): Response => new Response(
  JSON.stringify(body),
  { status, headers: { 'Content-Type': 'application/json' } },
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('adds, lists, and deletes a provider without retaining its key in the form', async () => {
  const providers: Array<Record<string, unknown>> = [];
  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/config/status') {
      return jsonResponse({ hasKey: true, source: 'file', state: 'unlocked' });
    }
    if (url === '/api/config/guide') {
      return jsonResponse({ needsSetup: false, message: '', instructions: [] });
    }
    if (url === '/api/config/providers' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const provider = { ...body, apiKey: undefined, hasApiKey: true };
      providers.push(provider);
      return jsonResponse({ provider }, 201);
    }
    if (url === '/api/config/providers') {
      return jsonResponse({ providers });
    }
    if (url === '/api/config/providers/fake-compatible' && init?.method === 'DELETE') {
      providers.splice(0);
      return jsonResponse({ status: 'ok' });
    }
    return jsonResponse({}, 404);
  });
  vi.stubGlobal('fetch', fetchSpy);
  render(<ConfigPage mode="local" />);

  await screen.findByText('API Key 状态');
  await userEvent.type(screen.getByLabelText('Provider ID'), 'fake-compatible');
  await userEvent.type(screen.getByLabelText('Provider name'), 'Fake Compatible Provider');
  await userEvent.type(screen.getByLabelText('Base URL'), 'https://provider.invalid/v1');
  await userEvent.type(screen.getByLabelText('Model'), 'fake-model-v1');
  await userEvent.type(screen.getByLabelText('Provider API Key'), 'fake-provider-key-sentinel');
  await userEvent.click(screen.getByRole('button', { name: 'Add provider' }));

  await screen.findByText('Fake Compatible Provider');
  expect((screen.getByLabelText('Provider API Key') as HTMLInputElement).value).toBe('');
  const createCall = fetchSpy.mock.calls.find(([url, init]) => (
    String(url) === '/api/config/providers' && init?.method === 'POST'
  ));
  expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
    id: 'fake-compatible',
    name: 'Fake Compatible Provider',
    baseUrl: 'https://provider.invalid/v1',
    model: 'fake-model-v1',
    apiKey: 'fake-provider-key-sentinel',
  });

  await userEvent.click(screen.getByRole('button', { name: 'Delete Fake Compatible Provider' }));
  await waitFor(() => expect(screen.queryByText('Fake Compatible Provider')).toBeNull());
});

it('loads stored providers after unlocking a locked credential store', async () => {
  let unlocked = false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/config/status') {
      return jsonResponse({ hasKey: true, source: 'file', state: unlocked ? 'unlocked' : 'locked' });
    }
    if (url === '/api/config/guide') {
      return jsonResponse({ needsSetup: false, message: '', instructions: [] });
    }
    if (url === '/api/config/unlock' && init?.method === 'POST') {
      unlocked = true;
      return jsonResponse({ status: 'unlocked' });
    }
    if (url === '/api/config/providers' && unlocked) {
      return jsonResponse({ providers: [{
        id: 'fake-compatible',
        name: 'Stored Fake Provider',
        baseUrl: 'https://provider.invalid/v1',
        model: 'fake-model-v1',
        hasApiKey: true,
      }] });
    }
    return jsonResponse({ error: 'CREDENTIAL_STORE_LOCKED' }, 423);
  }));
  render(<ConfigPage mode="local" />);

  await screen.findByLabelText('主密码');
  await userEvent.type(screen.getByLabelText('主密码'), 'correct horse battery staple');
  await userEvent.click(screen.getByRole('button', { name: '解锁凭据' }));

  await screen.findByText('Stored Fake Provider');
});
