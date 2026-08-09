import { Router, type Request, type Response } from 'express';
import type { CredentialStore } from '../credential-store.js';
import type { RuntimePolicy } from '../security/runtime-policy.js';

const SERVICE_NAME = 'harness/deepseek-api-key';

export interface ConfigRouterDependencies {
  readonly policy: RuntimePolicy;
  readonly credentialStore: CredentialStore;
}

export const createConfigRouter = (
  dependencies: ConfigRouterDependencies,
): Router => {
  const router = Router();

  if (!dependencies.policy.allowServerCredentials) {
    router.use((_req: Request, res: Response) => {
      res.status(403).json({ error: 'CONFIG_DISABLED' });
    });
    return router;
  }

  router.get('/status', (_req: Request, res: Response) => {
    const hasKey = dependencies.credentialStore.hasKey(SERVICE_NAME);
    const source = process.env.DEEPSEEK_API_KEY
      ? 'env'
      : hasKey ? 'file' : 'none';
    res.json({ hasKey, source, state: dependencies.credentialStore.getState() });
  });

  router.post('/unlock', (req: Request, res: Response) => {
    const masterPassword = req.body?.masterPassword;
    if (typeof masterPassword !== 'string' || !dependencies.credentialStore.unlock(masterPassword)) {
      res.status(401).json({ error: 'INVALID_MASTER_PASSWORD' });
      return;
    }
    res.json({ status: 'unlocked' });
  });

  router.post('/key', (req: Request, res: Response) => {
    const key = req.body?.key;
    if (typeof key !== 'string' || key.trim().length < 8) {
      res.status(400).json({ error: 'INVALID_API_KEY' });
      return;
    }
    const state = dependencies.credentialStore.getState();
    try {
      if (state === 'empty' || state === 'legacy') {
        const masterPassword = req.body?.masterPassword;
        if (typeof masterPassword !== 'string') {
          res.status(400).json({ error: 'MASTER_PASSWORD_REQUIRED' });
          return;
        }
        dependencies.credentialStore.initialize(masterPassword);
      } else if (state === 'locked') {
        res.status(423).json({ error: 'CREDENTIAL_STORE_LOCKED' });
        return;
      }
      dependencies.credentialStore.setKey(SERVICE_NAME, key.trim());
    } catch (error) {
      if (error instanceof Error && error.message === 'MASTER_PASSWORD_TOO_SHORT') {
        res.status(400).json({ error: 'MASTER_PASSWORD_TOO_SHORT' });
        return;
      }
      throw error;
    }
    res.json({ status: 'ok', message: 'API key stored' });
  });

  router.post('/lock', (_req: Request, res: Response) => {
    dependencies.credentialStore.lock();
    res.json({ status: 'locked' });
  });

  router.delete('/key', (_req: Request, res: Response) => {
    if (dependencies.credentialStore.getState() === 'locked') {
      res.status(423).json({ error: 'CREDENTIAL_STORE_LOCKED' });
      return;
    }
    dependencies.credentialStore.deleteKey(SERVICE_NAME);
    res.json({ status: 'ok', message: 'API key removed' });
  });

  router.get('/guide', (_req: Request, res: Response) => {
    const hasKey = dependencies.credentialStore.hasKey(SERVICE_NAME);
    res.json({
      needsSetup: !hasKey,
      state: dependencies.credentialStore.getState(),
      message: hasKey
        ? 'API key is configured.'
        : 'Configure a DeepSeek API key to use a real model. Without one, the demo uses scripted responses.',
      instructions: [
        'Create a key at https://platform.deepseek.com/api-keys',
        'Enter it on the local configuration page',
        'For deployments, prefer the DEEPSEEK_API_KEY environment variable',
      ],
    });
  });

  return router;
};
