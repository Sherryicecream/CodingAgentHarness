import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, type AppOptions, type HarnessApp } from './app.js';
import { resolveRuntimePolicy } from './security/runtime-policy.js';

export const startServer = async (): Promise<HarnessApp> => {
  const policy = resolveRuntimePolicy(process.env.HARNESS_MODE);
  let localOptions: Pick<AppOptions, 'credentialStore' | 'sessionStore'> = {};
  if (policy.mode === 'local') {
    const [{ createCredentialStore }, { loadCredentialKeyring }, { createSessionStore }] = await Promise.all([
      import('./credential-store.js'),
      import('./credential-keyring.js'),
      import('@harness/core'),
    ]);
    localOptions = {
      credentialStore: createCredentialStore({ keyring: await loadCredentialKeyring() }),
      sessionStore: createSessionStore('.harness-sessions'),
    };
  }
  const app = createApp({ mode: policy.mode, ...localOptions });
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const host = process.env.HOST || '127.0.0.1';
  await new Promise<void>((resolveListening, rejectListening) => {
    let server: ReturnType<typeof app.listen>;
    const onListening = (): void => {
      server.removeListener('error', onError);
      console.log(`Harness server started: http://${host}:${port}`);
      resolveListening();
    };
    const onError = (error: Error): void => {
      server.removeListener('listening', onListening);
      void app.close().then(
        () => rejectListening(error),
        () => rejectListening(error),
      );
    };
    server = app.listen(port, host, onListening);
    server.once('error', onError);
  });
  return app;
};

const entryPath = process.argv[1];
if (entryPath && resolve(entryPath) === resolve(fileURLToPath(import.meta.url))) {
  void startServer().catch((error: unknown) => {
    console.error('Harness server failed to start', error);
    process.exitCode = 1;
  });
}
