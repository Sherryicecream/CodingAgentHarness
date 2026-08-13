import type { Request, Response } from 'express';
import type { CredentialStore } from '../credential-store.js';

export interface TestKeyDependencies {
  readonly credentialStore: CredentialStore;
  readonly fetchImpl?: typeof fetch;
}

export const handleTestKey = async (
  dependencies: TestKeyDependencies,
  _req: Request,
  res: Response,
): Promise<void> => {
  const apiKey = dependencies.credentialStore.getKey()
    ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.json({ valid: false, error: 'API_KEY_NOT_CONFIGURED' });
    return;
  }
  let response: globalThis.Response;
  try {
    response = await (dependencies.fetchImpl ?? fetch)(
    `${process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/models`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
    );
  } catch {
    res.json({ valid: false, error: 'API_CONNECTION_FAILED' });
    return;
  }
  if (response.ok) {
    res.json({ valid: true });
    return;
  }
  const error = response.status === 401 || response.status === 403
    ? 'API_KEY_INVALID'
    : response.status === 402
      ? 'API_BILLING_REQUIRED'
      : response.status === 429
        ? 'API_RATE_LIMITED'
        : response.status >= 500
          ? 'API_SERVICE_UNAVAILABLE'
          : 'API_REQUEST_REJECTED';
  res.json({ valid: false, error });
};
