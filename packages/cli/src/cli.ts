#!/usr/bin/env node
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('Harness - Coding Agent');
  console.log('Starting server...');

  // Start the server
  const serverPath = path.resolve(__dirname, '../../server/dist/server.js');

  try {
    // Try to import and start the server
    const serverProcess = exec(`node "${serverPath}"`, {
      env: { ...process.env, NODE_ENV: 'production' },
    }, (error, stdout, stderr) => {
      if (error) console.error('Server error:', error.message);
    });

    serverProcess.stdout?.pipe(process.stdout);
    serverProcess.stderr?.pipe(process.stderr);

    console.log('Server starting at http://localhost:3000');

    // Try to open browser
    const { default: open } = await import('open');
    await open('http://localhost:3000');
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

main();