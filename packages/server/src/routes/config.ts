import { Router, Request, Response } from 'express';

export const configRouter = Router();

// GET /api/config/status — Check API key configuration status
configRouter.get('/status', (_req: Request, res: Response) => {
  res.json({ hasKey: false });
});

// POST /api/config/key — Set API key (placeholder)
configRouter.post('/key', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'API key configuration is a placeholder' });
});

// DELETE /api/config/key — Remove API key (placeholder)
configRouter.delete('/key', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'API key removed' });
});