import { createApp } from './app.js';

const app = createApp();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = process.env.HOST || '127.0.0.1';

app.listen(PORT, HOST, () => {
  console.log(`Harness server started: http://${HOST}:${PORT}`);
});

export default app;
