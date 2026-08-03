import { Router, Request, Response } from 'express';
import { createCredentialStore } from '../credential-store.js';

export const configRouter = Router();

const SERVICE_NAME = 'harness/deepseek-api-key';
const store = createCredentialStore();

// GET /api/config/status — Check API key configuration status
configRouter.get('/status', (_req: Request, res: Response) => {
  const hasKey = store.hasKey(SERVICE_NAME);
  const source = process.env.DEEPSEEK_API_KEY ? 'env' : (store.hasKey(SERVICE_NAME) ? 'file' : 'none');
  res.json({ hasKey, source });
});

// POST /api/config/key — Store API key
configRouter.post('/key', (req: Request, res: Response) => {
  const { key } = req.body;
  if (!key || typeof key !== 'string') {
    res.status(400).json({ error: 'key is required and must be a string' });
    return;
  }
  if (key.trim().length < 8) {
    res.status(400).json({ error: 'key appears too short (minimum 8 characters)' });
    return;
  }
  store.setKey(SERVICE_NAME, key.trim());
  res.json({ status: 'ok', message: 'API key stored securely' });
});

// DELETE /api/config/key — Remove stored API key
configRouter.delete('/key', (_req: Request, res: Response) => {
  store.deleteKey(SERVICE_NAME);
  res.json({ status: 'ok', message: 'API key removed' });
});

// GET /api/config/guide — Get first-run guide information
configRouter.get('/guide', (_req: Request, res: Response) => {
  const hasKey = store.hasKey(SERVICE_NAME);
  res.json({
    needsSetup: !hasKey,
    message: hasKey
      ? 'API key is configured'
      : 'No API key found. Please configure your DeepSeek API key to use the real LLM. '
        + 'Without a key, the harness will run in mock mode with predefined responses.',
    instructions: [
      '1. Visit https://platform.deepseek.com/api-keys to get your API key',
      '2. Enter the key in the configuration page (it will be stored encrypted)',
      '3. Or set the DEEPSEEK_API_KEY environment variable for production deployment',
    ],
  });
});