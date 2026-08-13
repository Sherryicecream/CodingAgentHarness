// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { saveSessionFile } from '../../client/src/components/ChatPanel.js';

afterEach(() => vi.unstubAllGlobals());

it('posts a relative file name and returns the saved path', async () => {
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ path: 'C:/project/.harness/outputs/src/example.ts' }), { status: 201 }));
  vi.stubGlobal('fetch', fetchSpy);
  await expect(saveSessionFile('session/1', 'src/example.ts')).resolves.toEqual({ path: 'C:/project/.harness/outputs/src/example.ts' });
  expect(fetchSpy).toHaveBeenCalledWith('/api/agent/sessions/session%2F1/save', expect.objectContaining({ method: 'POST', body: JSON.stringify({ fileName: 'src/example.ts' }) }));
});

it('surfaces server save errors', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'PERSISTENCE_DISABLED' }), { status: 403 })));
  await expect(saveSessionFile('session', 'out.txt')).rejects.toThrow('PERSISTENCE_DISABLED');
});
