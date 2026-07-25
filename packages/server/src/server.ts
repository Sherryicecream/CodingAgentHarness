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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Harness server running at http://localhost:${PORT}`);
});

export default app;