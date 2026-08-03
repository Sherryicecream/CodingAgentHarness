import { Router, Request, Response } from 'express';
import { createSessionStore } from '@harness/core';

export const sessionRouter = Router();

const sessionStore = createSessionStore('.harness-sessions');

// GET /api/sessions — List all sessions
sessionRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const sessions = await sessionStore.list();
    res.json({ sessions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions/:id — Get single session
sessionRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const session = await sessionStore.load(req.params.id);
    if (!session) {
      res.status(404).json({ error: '未找到会话' });
      return;
    }
    res.json({ session });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});