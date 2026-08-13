// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfigPage } from '../../client/src/components/ConfigPage.js';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('shows clear Chinese DeepSeek guidance and password lifecycle controls', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/config/status') return response({ hasKey: false, source: 'none', state: 'empty' });
    if (String(input) === '/api/config/guide') return response({ needsSetup: true, message: '', instructions: ['请访问 https://platform.deepseek.com/api-keys 创建 API Key。', '部署时优先使用 DEEPSEEK_API_KEY 环境变量。'] });
    return response({});
  }));
  render(<ConfigPage mode="local" />);
  expect(await screen.findByText(/请访问/)).toBeTruthy();
  expect(screen.getByText(/首次设置主密码/)).toBeTruthy();
});

it('offers test connection and delete configuration actions', async () => {
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/config/status') return response({ hasKey: true, source: 'file', state: 'unlocked' });
    if (String(input) === '/api/config/guide') return response({ needsSetup: false, message: '', instructions: [] });
    if (String(input) === '/api/agent/test-key') return response({ valid: true });
    return response({ status: 'ok' });
  });
  vi.stubGlobal('fetch', fetchSpy);
  render(<ConfigPage mode="local" />);
  expect(await screen.findByRole('button', { name: '测试连接' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '删除配置' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: '测试连接' }));
  expect(fetchSpy).toHaveBeenCalledWith('/api/agent/test-key', expect.objectContaining({ method: 'POST' }));
});

it('shows test connection when a key comes from the environment', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/config/status') return response({ hasKey: true, source: 'env', state: 'empty' });
    if (String(input) === '/api/config/guide') return response({ needsSetup: false, message: '', instructions: [] });
    return response({});
  }));
  render(<ConfigPage mode="local" />);
  expect(await screen.findByRole('button', { name: '测试连接' })).toBeTruthy();
});

it('does not expose provider add controls', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/config/status') return response({ hasKey: true, source: 'file', state: 'unlocked' });
    if (String(input) === '/api/config/guide') return response({ needsSetup: false, message: '', instructions: [] });
    return response({});
  }));
  render(<ConfigPage mode="local" />);
  await screen.findByText('DeepSeek 配置');
  expect(screen.queryByRole('button', { name: /添加服务商|添加 Provider/i })).toBeNull();
});

it('submits the API key with the first master password', async () => {
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/config/status') return response({ hasKey: false, source: 'none', state: 'empty' });
    if (String(input) === '/api/config/guide') return response({ needsSetup: true, message: '', instructions: [] });
    if (String(input) === '/api/config/key') return response({ status: 'ok' });
    return response({});
  });
  vi.stubGlobal('fetch', fetchSpy);
  render(<ConfigPage mode="local" />);
  await screen.findByLabelText('DeepSeek API Key（不会回显）');
  await userEvent.type(screen.getByLabelText('DeepSeek API Key（不会回显）'), 'sk-test-value');
  await userEvent.type(screen.getByLabelText(/设置主密码/), 'correct horse battery staple');
  await userEvent.type(screen.getByLabelText(/确认主密码/), 'correct horse battery staple');
  await userEvent.click(screen.getByRole('button', { name: '保存 DeepSeek API Key' }));
  expect(fetchSpy).toHaveBeenCalledWith('/api/config/key', expect.objectContaining({ method: 'POST' }));
});

it('requires matching confirmation before saving a new master password', async () => {
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/config/status') return response({ hasKey: false, source: 'none', state: 'empty' });
    if (String(input) === '/api/config/guide') return response({ needsSetup: true, message: '', instructions: [] });
    return response({ status: 'ok' });
  });
  vi.stubGlobal('fetch', fetchSpy);
  render(<ConfigPage mode="local" />);
  await screen.findByLabelText(/DeepSeek API Key/);
  await userEvent.type(screen.getByLabelText(/DeepSeek API Key/), 'sk-test-value');
  await userEvent.type(screen.getByLabelText(/设置主密码/), 'correct horse battery staple');
  const confirmation = screen.getByLabelText(/确认主密码/);
  await userEvent.type(confirmation, 'different password');
  await userEvent.click(screen.getByRole('button', { name: '保存 DeepSeek API Key' }));
  expect(screen.getByRole('status').textContent).toMatch(/主密码不一致/);
  expect(fetchSpy).not.toHaveBeenCalledWith('/api/config/key', expect.anything());
});
