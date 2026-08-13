import { Router, type Request, type Response } from 'express';
import type { CredentialStore } from '../credential-store.js';
import type { RuntimePolicy } from '../security/runtime-policy.js';

export interface ConfigRouterDependencies {
  readonly policy: RuntimePolicy;
  readonly credentialStore: CredentialStore;
}

export const createConfigRouter = ({ policy, credentialStore }: ConfigRouterDependencies): Router => {
  const router = Router();
  if (!policy.allowServerCredentials) {
    router.use((_req: Request, res: Response) => {
      res.status(403).json({ error: 'CONFIG_DISABLED' });
    });
    return router;
  }

  router.get('/status', (_req, res) => {
    if (process.env.DEEPSEEK_API_KEY) {
      res.json({ storage: 'memory', hasKey: true });
      return;
    }
    res.json(credentialStore.status());
  });

  router.put('/key', (req, res) => {
    const key = req.body?.key;
    if (typeof key !== 'string' || key.trim().length < 8) {
      res.status(400).json({ error: 'INVALID_API_KEY' });
      return;
    }
    try {
      credentialStore.setKey(key.trim());
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ error: 'KEYRING_UNAVAILABLE' });
    }
  });

  router.delete('/key', (_req, res) => {
    try {
      credentialStore.deleteKey();
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ error: 'KEYRING_UNAVAILABLE' });
    }
  });

  return router;
};
