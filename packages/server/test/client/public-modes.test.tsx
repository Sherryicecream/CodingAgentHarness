// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../client/src/App.js';
import { ChatPanel, isByokBrowserAllowed } from '../../client/src/components/ChatPanel.js';

interface SessionResponse {
  sessionId: string;
  mode: 'public' | 'local';
  capabilities: {
    allowedExperiences: Array<'demo' | 'byok' | 'server'>;
    allowByok: boolean;
    allowProcessTools: boolean;
    allowServerCredentials: boolean;
    allowHttpByok: boolean;
  };
  expiresAt: string;
}

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event('open'));
  }

  emit(type: string, data: unknown): void {
    this.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ type, data, timestamp: new Date(0).toISOString() }),
    }));
  }

  fail(): void {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.(new Event('error'));
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean { return true; }
}

const publicSession = (id = 'server-session-1'): SessionResponse => ({
  sessionId: id,
  mode: 'public',
  capabilities: {
    allowedExperiences: ['demo', 'byok'],
    allowByok: true,
    allowProcessTools: false,
    allowServerCredentials: false,
    allowHttpByok: false,
  },
  expiresAt: '2030-01-01T00:00:00.000Z',
});

const localSession = (id = 'local-session-1'): SessionResponse => ({
  sessionId: id,
  mode: 'local',
  capabilities: {
    allowedExperiences: ['demo', 'byok', 'server'],
    allowByok: true,
    allowProcessTools: true,
    allowServerCredentials: true,
    allowHttpByok: false,
  },
  expiresAt: '2030-01-01T00:00:00.000Z',
});

const jsonResponse = (body: unknown, status = 200): Response => new Response(
  JSON.stringify(body),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const installFetch = (
  session: SessionResponse,
  onRequest?: (url: string, init?: RequestInit) => Response | Promise<Response>,
) => {
  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/agent/sessions') {
      return jsonResponse(session, 201);
    }
    if (onRequest) {
      return onRequest(url, init);
    }
    return jsonResponse({ sessionId: session.sessionId, status: 'started' }, 202);
  });
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
};

const renderLoadedApp = async (session: SessionResponse = publicSession()) => {
  const fetchSpy = installFetch(session);
  render(<App />);
  await screen.findByText(session.mode === 'public' ? '公开安全模式' : '本地可信模式');
  return fetchSpy;
};

beforeEach(() => {
  FakeEventSource.instances = [];
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('EventSource', FakeEventSource);
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('runtime-owned public and local surfaces', () => {
  it('shows public experiences and server-issued capability labels', async () => {
    await renderLoadedApp();

    expect(screen.getByRole('radio', { name: '安全演示' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '使用自己的 API Key' })).toBeTruthy();
    expect(screen.getByText('进程工具：禁用')).toBeTruthy();
    expect(screen.getByText('服务器凭据：禁用')).toBeTruthy();
    expect(screen.getByRole('button', { name: '历史' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '配置' })).toBeTruthy();
  });

  it('preserves credential configuration only in local mode', async () => {
    await renderLoadedApp(localSession());

    expect(screen.getByRole('button', { name: '配置' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '历史' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '本地服务器凭据' })).toBeTruthy();
    expect(screen.getByText('进程工具：启用')).toBeTruthy();
  });

  it('keeps the public history page without requesting a private history endpoint', async () => {
    const fetchSpy = installFetch(publicSession());
    localStorage.setItem('harness.public.session-history.v1', JSON.stringify([{
      id: 'public-history-1',
      createdAt: '2026-08-09T00:00:00.000Z',
      task: '之前的问题',
      status: 'completed',
      conclusion: '任务完成',
      feedbackRuns: [],
    }]));
    await renderLoadedApp();

    await userEvent.click(screen.getByRole('button', { name: '历史' }));

    expect(screen.getByText('之前的问题')).toBeTruthy();
    expect(fetchSpy.mock.calls.some(([url]) => String(url) === '/api/sessions')).toBe(false);
  });

  it('shows the config page with a public-mode notice when navigating to /config', async () => {
    window.history.replaceState({}, '', '/config');
    const fetchSpy = installFetch(publicSession(), (url) => {
      if (String(url).startsWith('/api/config/')) {
        return jsonResponse({ error: 'CONFIG_DISABLED' }, 403);
      }
      return undefined;
    });
    render(<App />);
    await screen.findByText('配置');
    expect(screen.getByText(/配置页面仅在本地模式下可用/)).toBeTruthy();
    expect(fetchSpy.mock.calls.some(([url]) => String(url).startsWith('/api/config/'))).toBe(true);
  });
});

describe('BYOK browser boundary', () => {
  it('disables BYOK on an insecure non-loopback origin with an HTTPS explanation', async () => {
    await renderLoadedApp();

    const byok = screen.getByRole('radio', { name: '使用自己的 API Key' }) as HTMLInputElement;
    expect(byok.disabled).toBe(true);
    expect(screen.getByText(/HTTPS/)).toBeTruthy();
  });

  it('enables BYOK in a secure context', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    await renderLoadedApp();

    expect((screen.getByRole('radio', { name: '使用自己的 API Key' }) as HTMLInputElement).disabled).toBe(false);
  });

  it.each(['localhost', '127.0.0.1', '::1', '[::1]'])(
    'allows loopback development on %s',
    (hostname) => {
      expect(isByokBrowserAllowed({ isSecureContext: false, hostname })).toBe(true);
    },
  );
});

describe('server-session-first run flow', () => {
  it('issues only one bootstrap session during React StrictMode effect replay', async () => {
    const fetchSpy = installFetch(publicSession());

    render(<React.StrictMode><App /></React.StrictMode>);
    await screen.findByText('公开安全模式');

    expect(fetchSpy.mock.calls.filter(([url]) => url === '/api/agent/sessions')).toHaveLength(1);
  });

  it('waits for SSE open and sends the exact demo request using the server ID', async () => {
    const order: string[] = [];
    const bodies: unknown[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/agent/sessions') {
        order.push('session');
        return jsonResponse(publicSession('issued-by-server'), 201);
      }
      order.push('run');
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ sessionId: 'issued-by-server', status: 'started' }, 202);
    });
    vi.stubGlobal('fetch', fetchSpy);
    render(<App />);
    await screen.findByText('公开安全模式');

    await userEvent.type(screen.getByLabelText('任务'), 'write a safe file');
    await userEvent.click(screen.getByRole('button', { name: '开始运行' }));

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.instances[0].url).toBe('/api/agent/stream/issued-by-server');
    expect(order).toEqual(['session']);
    FakeEventSource.instances[0].open();
    await waitFor(() => expect(order).toEqual(['session', 'run']));
    expect(bodies).toEqual([{
      sessionId: 'issued-by-server',
      task: 'write a safe file',
      mode: 'demo',
    }]);
  });

  it('blocks duplicate submission while the stream is starting and running', async () => {
    const fetchSpy = await renderLoadedApp();
    await userEvent.type(screen.getByLabelText('任务'), 'one task');
    const submit = screen.getByRole('button', { name: '开始运行' });

    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0].open();
    await waitFor(() => expect(fetchSpy.mock.calls.filter(([url]) => url === '/api/agent/run')).toHaveLength(1));
    expect(fetchSpy.mock.calls.filter(([url]) => url === '/api/agent/sessions')).toHaveLength(1);
  });

  it('closes the active stream when the component unmounts', async () => {
    installFetch(publicSession());
    const { unmount } = render(<App />);
    await screen.findByText('公开安全模式');
    await userEvent.type(screen.getByLabelText('任务'), 'unmount task');
    await userEvent.click(screen.getByRole('button', { name: '开始运行' }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    unmount();

    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it('does not open SSE or post a key when unmounted during session acquisition', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    let resolveSession!: (session: SessionResponse) => void;
    const pendingSession = new Promise<SessionResponse>((resolve) => {
      resolveSession = resolve;
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { unmount } = render(
      <ChatPanel runtimeInfo={publicSession()} acquireSession={() => pendingSession} />,
    );
    await userEvent.click(screen.getByRole('radio', { name: '使用自己的 API Key' }));
    await userEvent.type(screen.getByLabelText('DeepSeek API Key'), 'arbitrary-format-secret');
    await userEvent.type(screen.getByLabelText('任务'), 'deferred task');
    await userEvent.click(screen.getByRole('button', { name: '开始运行' }));

    unmount();
    await act(async () => {
      resolveSession(publicSession('late-session'));
      await pendingSession;
    });

    expect(FakeEventSource.instances).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('closes the previous stream before rebinding a retry to a new server session', async () => {
    let sessionCount = 0;
    let runCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agent/sessions') {
        sessionCount += 1;
        return jsonResponse(publicSession(`server-session-${sessionCount}`), 201);
      }
      runCount += 1;
      return jsonResponse({ error: 'RUN_START_FAILED' }, runCount === 1 ? 500 : 202);
    }));
    render(<App />);
    await screen.findByText('公开安全模式');
    await userEvent.type(screen.getByLabelText('任务'), 'retry task');
    await userEvent.click(screen.getByRole('button', { name: '开始运行' }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0].open();
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: '开始运行' }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));

    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(FakeEventSource.instances[1].url).toBe('/api/agent/stream/server-session-2');
  });

  it('closes a completed stream before binding the next run to a new server session', async () => {
    let sessionCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agent/sessions') {
        sessionCount += 1;
        return jsonResponse(publicSession(`server-session-${sessionCount}`), 201);
      }
      return jsonResponse({ status: 'started' }, 202);
    }));
    render(<App />);
    await screen.findByText('公开安全模式');
    await userEvent.type(screen.getByLabelText('任务'), 'repeatable task');
    await userEvent.click(screen.getByRole('button', { name: '开始运行' }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    await act(async () => FakeEventSource.instances[0].open());
    await act(async () => FakeEventSource.instances[0].emit(
      'complete',
      { stage: 'demo_complete', status: 'completed' },
    ));
    await screen.findByText('✓ 任务完成');

    await waitFor(() => expect(screen.getByRole('button', { name: '开始运行' })).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: '开始运行' }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));

    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(FakeEventSource.instances[1].url).toBe('/api/agent/stream/server-session-2');
  });

  it('renders deterministic demo tool and feedback payloads without a legacy shape adapter', async () => {
    await renderLoadedApp();
    await userEvent.type(screen.getByLabelText('任务'), 'demo payload task');
    await userEvent.click(screen.getByRole('button', { name: '开始运行' }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const stream = FakeEventSource.instances[0];
    await act(async () => stream.open());
    stream.emit('tool_call', {
      sessionId: 'server-session-1',
      stage: 'dangerous_action_blocked',
      name: 'write_file',
      riskLevel: 'dangerous',
      status: 'failed',
      result: { success: false, output: '', error: 'BLOCKED_BY_GOVERNANCE' },
    });
    stream.emit('feedback', {
      sessionId: 'server-session-1',
      stage: 'structured_feedback',
      status: 'fail',
      actionableFix: { summary: '1 test failure(s) detected.' },
    });
    stream.emit('complete', { stage: 'demo_complete', status: 'completed' });

    expect(await screen.findByText('write_file')).toBeTruthy();
    expect(screen.getByText('验证失败')).toBeTruthy();
    expect(screen.getByText('1 test failure(s) detected.')).toBeTruthy();
    expect(screen.getByText('✓ 任务完成')).toBeTruthy();
  });
});

describe('transient key lifecycle', () => {
  it('keeps a BYOK key out of browser storage and logs, sends it once, then clears it', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    const key = 'sk-test-sentinel-never-real';
    const localSet = vi.spyOn(Storage.prototype, 'setItem');
    const consoleSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    const bodies: unknown[] = [];
    installFetch(publicSession(), (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ sessionId: 'server-session-1', status: 'started' }, 202);
    });
    render(<App />);
    await screen.findByText('公开安全模式');
    await userEvent.click(screen.getByRole('radio', { name: '使用自己的 API Key' }));
    await userEvent.type(screen.getByLabelText('DeepSeek API Key'), key);
    await userEvent.type(screen.getByLabelText('任务'), 'safe byok task');
    await userEvent.click(screen.getByRole('button', { name: '开始运行' }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0].open();

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      sessionId: 'server-session-1',
      task: 'safe byok task',
      mode: 'byok',
      apiKey: key,
    });
    await waitFor(() => expect((screen.getByLabelText('DeepSeek API Key') as HTMLInputElement).value).toBe(''));
    expect(localSet).not.toHaveBeenCalled();
    expect(localStorage.getItem('harness.public.session-history.v1') ?? '').not.toContain(key);
    expect(sessionStorage.length).toBe(0);
    expect(consoleSpies.flatMap(spy => spy.mock.calls).flat().join(' ')).not.toContain(key);
    expect(window.location.href).not.toContain(key);
  });

  it('clears the key on mode switch and every connection or terminal failure path', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    await renderLoadedApp();
    const byok = screen.getByRole('radio', { name: '使用自己的 API Key' });
    const demo = screen.getByRole('radio', { name: '安全演示' });
    await userEvent.click(byok);
    const keyInput = screen.getByLabelText('DeepSeek API Key') as HTMLInputElement;
    await userEvent.type(keyInput, 'sk-test-mode-switch');
    await userEvent.click(demo);
    await userEvent.click(byok);
    expect((screen.getByLabelText('DeepSeek API Key') as HTMLInputElement).value).toBe('');

    await userEvent.type(screen.getByLabelText('DeepSeek API Key'), 'sk-test-stream-failure');
    await userEvent.type(screen.getByLabelText('任务'), 'failing task');
    await userEvent.click(screen.getByRole('button', { name: '开始运行' }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0].fail();
    await waitFor(() => expect((screen.getByLabelText('DeepSeek API Key') as HTMLInputElement).value).toBe(''));
  });

  it('clears the key on a terminal SSE error and closes the stream', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    await renderLoadedApp();
    await userEvent.click(screen.getByRole('radio', { name: '使用自己的 API Key' }));
    await userEvent.type(screen.getByLabelText('DeepSeek API Key'), 'sk-test-terminal');
    await userEvent.type(screen.getByLabelText('任务'), 'terminal task');
    await userEvent.click(screen.getByRole('button', { name: '开始运行' }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0].open();
    FakeEventSource.instances[0].emit('error', {
      error: 'LLM_PROVIDER_ERROR',
      unsafe: 'sk-test-terminal',
    });

    await waitFor(() => expect((screen.getByLabelText('DeepSeek API Key') as HTMLInputElement).value).toBe(''));
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(document.body.textContent).not.toContain('sk-test-terminal');
  });

  it('clears the key when session creation fails before opening a stream', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    render(
      <ChatPanel
        runtimeInfo={publicSession()}
        acquireSession={async () => { throw new Error('SESSION_ISSUE_FAILED'); }}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: '使用自己的 API Key' }));
    await userEvent.type(screen.getByLabelText('DeepSeek API Key'), 'sk-test-session-failure');
    await userEvent.type(screen.getByLabelText('任务'), 'session failure task');
    await userEvent.click(screen.getByRole('button', { name: '开始运行' }));

    await waitFor(() => expect((screen.getByLabelText('DeepSeek API Key') as HTMLInputElement).value).toBe(''));
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(screen.getByRole('alert').textContent).not.toContain('sk-test-session-failure');
  });

  it('clears the key and closes the stream when the run request is rejected', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    installFetch(publicSession(), () => jsonResponse({ error: 'RUN_START_FAILED' }, 500));
    render(<App />);
    await screen.findByText('公开安全模式');
    await userEvent.click(screen.getByRole('radio', { name: '使用自己的 API Key' }));
    await userEvent.type(screen.getByLabelText('DeepSeek API Key'), 'sk-test-run-failure');
    await userEvent.type(screen.getByLabelText('任务'), 'run failure task');
    await userEvent.click(screen.getByRole('button', { name: '开始运行' }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0].open();

    await waitFor(() => expect((screen.getByLabelText('DeepSeek API Key') as HTMLInputElement).value).toBe(''));
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(screen.getByRole('alert').textContent).not.toContain('sk-test-run-failure');
  });

  it('never renders a key echoed by tool or feedback return payloads', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    const key = 'arbitrary-format-return-secret';
    await renderLoadedApp();
    await userEvent.click(screen.getByRole('radio', { name: '使用自己的 API Key' }));
    await userEvent.type(screen.getByLabelText('DeepSeek API Key'), key);
    await userEvent.type(screen.getByLabelText('任务'), 'redact returned secret');
    await userEvent.click(screen.getByRole('button', { name: '开始运行' }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const stream = FakeEventSource.instances[0];
    await act(async () => stream.open());
    await waitFor(() => expect((screen.getByLabelText('DeepSeek API Key') as HTMLInputElement).value).toBe(''));

    await act(async () => stream.emit('tool_call', {
      name: 'read_file',
      riskLevel: 'safe',
      stage: `untrusted-stage-${key}`,
      status: `untrusted-status-${key}`,
      result: {
        success: true,
        output: `provider returned ${key}`,
        error: `provider error ${key}`,
      },
    }));
    await act(async () => stream.emit('feedback', {
      status: 'fail',
      actionableFix: { summary: `retry without ${key}` },
    }));

    expect(await screen.findByText('read_file')).toBeTruthy();
    expect(document.body.textContent).not.toContain(key);
  });

  it('preserves detailed tool and feedback diagnostics in local trusted mode', async () => {
    await renderLoadedApp(localSession());
    await userEvent.type(screen.getByLabelText('任务'), 'trusted diagnostics');
    await userEvent.click(screen.getByRole('button', { name: '开始运行' }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const stream = FakeEventSource.instances[0];
    stream.open();
    await act(async () => stream.emit('tool_call', {
      name: 'shell',
      riskLevel: 'moderate',
      result: { success: false, output: 'trusted tool output', error: 'exit 1' },
    }));
    await act(async () => stream.emit('feedback', {
      status: 'fail',
      failures: [{
        file: 'src/example.ts',
        line: 12,
        message: 'expected true to be false',
        type: 'assertion',
      }],
      actionableFix: { summary: 'update the trusted assertion' },
    }));

    expect(await screen.findByText('shell')).toBeTruthy();
    expect(document.body.textContent).toContain('trusted tool output');
    expect(document.body.textContent).toContain('src/example.ts:12');
    expect(document.body.textContent).toContain('expected true to be false');
    expect(document.body.textContent).toContain('断言');
  });
});
