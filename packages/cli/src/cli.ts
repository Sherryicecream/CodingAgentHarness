#!/usr/bin/env node
import { exec } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function main() {
  console.log('Harness - Coding Agent');
  console.log('Starting server...');

  const serverPath = require.resolve('@harness/server');

  try {
    // Try to import and start the server
    const serverProcess = exec(`node "${serverPath}"`, {
      env: { ...process.env, NODE_ENV: 'production' },
    }, (error, stdout, stderr) => {
      if (error) console.error('Server error:', error.message);
    });

    serverProcess.stdout?.pipe(process.stdout);
    serverProcess.stderr?.pipe(process.stderr);

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
