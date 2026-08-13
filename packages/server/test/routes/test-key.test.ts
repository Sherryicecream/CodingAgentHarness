import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { handleTestKey } from '../../src/routes/test-key.js';

const responseDouble = () => {
  const json = vi.fn();
  return { response: { json } as unknown as Response, json };
};

describe('test-key route', () => {
  it('uses the models authentication endpoint without generating a completion', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const { response, json } = responseDouble();
    await handleTestKey({ credentialStore: { getKey: () => 'secret' } as never, fetchImpl }, {} as Request, response);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.deepseek.com/models', expect.objectContaining({ method: 'GET' }));
    expect(json).toHaveBeenCalledWith({ valid: true });
  });

  it.each([[401, 'API_KEY_INVALID'], [402, 'API_BILLING_REQUIRED'], [429, 'API_RATE_LIMITED'], [500, 'API_SERVICE_UNAVAILABLE']])(
    'maps HTTP %s to %s', async (status, error) => {
      const { response, json } = responseDouble();
      await handleTestKey({ credentialStore: { getKey: () => 'secret' } as never, fetchImpl: async () => new Response('{}', { status }) }, {} as Request, response);
      expect(json).toHaveBeenCalledWith({ valid: false, error });
    },
  );
});
