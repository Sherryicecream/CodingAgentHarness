import { createApp } from './app.js';
import { resolveRuntimePolicy } from './security/runtime-policy.js';

const policy = resolveRuntimePolicy(process.env.HARNESS_MODE);
let localOptions = {};
if (policy.mode === 'local') {
  const [{ createCredentialStore }, { createSessionStore }] = await Promise.all([
    import('./credential-store.js'),
    import('@harness/core'),
  ]);
  localOptions = {
    credentialStore: createCredentialStore(),
    sessionStore: createSessionStore('.harness-sessions'),
  };
}
const app = createApp({ mode: policy.mode, ...localOptions });
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = process.env.HOST || '127.0.0.1';

app.listen(PORT, HOST, () => {
  console.log(`Harness server started: http://${HOST}:${PORT}`);
});

export default app;
