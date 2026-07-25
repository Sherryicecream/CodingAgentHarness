import express from 'express';
import cors from 'cors';
import { agentRouter } from './routes/agent.js';
import { sessionRouter } from './routes/session.js';
import { configRouter } from './routes/config.js';

const app = express();
app.use(cors());
app.use(express.json());

// API routes
app.use('/api/agent', agentRouter);
app.use('/api/sessions', sessionRouter);
app.use('/api/config', configRouter);

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// In production, serve the built frontend
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('dist/client'));
  app.get('*', (_req, res) => {
    res.sendFile('dist/client/index.html', { root: '.' });
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Harness server running at http://localhost:${PORT}`);
});

export default app;