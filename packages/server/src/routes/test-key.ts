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
  const apiKey = dependencies.credentialStore.getKey('harness/deepseek-api-key')
    ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.json({ valid: false, error: 'API_KEY_NOT_CONFIGURED' });
    return;
  }
  let response: globalThis.Response;
  try {
    response = await (dependencies.fetchImpl ?? fetch)(
    `${process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/v1/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 5,
      }),
    },
    );
  } catch {
    res.json({ valid: false, error: 'API_CONNECTION_FAILED' });
    return;
  }
  res.json(response.ok
    ? { valid: true }
    : { valid: false, error: `API returned ${response.status}` });
};
