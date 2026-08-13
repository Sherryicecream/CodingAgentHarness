#!/usr/bin/env node

async function main() {
  console.log('Harness - Coding Agent');
  console.log('Starting server...');

  try {
    process.env.HARNESS_MODE ??= 'local';
    process.env.NODE_ENV ??= 'production';
    const { startServer } = await import('@harness/server');
    await startServer();

    const host = process.env.HOST || '127.0.0.1';
    const port = process.env.PORT || '3000';
    const serverUrl = `http://${host}:${port}`;
    console.log(`Server starting at ${serverUrl}`);

    // Try to open browser
    const { default: open } = await import('open');
    await open(serverUrl);
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

main();
