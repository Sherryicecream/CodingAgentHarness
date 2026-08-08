import { Router, type Request, type Response } from 'express';
import type { SessionStore } from '@harness/core';

export const createSessionRouter = (sessionStore: SessionStore): Router => {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const sessions = await sessionStore.list();
      res.json({ sessions });
    } catch {
      res.status(500).json({ error: 'SESSION_HISTORY_READ_FAILED' });
    }
  });

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const session = await sessionStore.load(req.params.id);
      if (!session) {
        res.status(404).json({ error: 'SESSION_NOT_FOUND' });
        return;
      }
      res.json({ session });
    } catch {
      res.status(500).json({ error: 'SESSION_HISTORY_READ_FAILED' });
    }
  });

  return router;
};
