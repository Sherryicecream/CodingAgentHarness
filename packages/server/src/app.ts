import cors from 'cors';
import express, { type Express } from 'express';
import { agentRouter } from './routes/agent.js';
import { configRouter } from './routes/config.js';
import { sessionRouter } from './routes/session.js';

export type AppMode = 'local' | 'public';

export interface AppOptions {
  mode?: AppMode;
  workspaceRoot?: string;
  now?: () => Date;
  idGenerator?: () => string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, 'error' | 'info' | 'warn'>;
}

export const createApp = (options: AppOptions = {}): Express => {
  const app = express();
  const mode = options.mode ?? 'local';

  app.disable('x-powered-by');
  app.use(cors({ origin: false }));
  app.use(express.json({ limit: '64kb' }));

  app.use('/api/agent', agentRouter);
  app.use('/api/sessions', sessionRouter);
  app.use('/api/config', configRouter);

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', mode }));

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static('dist/client'));
    app.get('*', (_req, res) => {
      res.sendFile('dist/client/index.html', { root: '.' });
    });
  }

  return app;
};
