import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestRunner } from '../../src/feedback/test-runner.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Retry fs.rmSync a few times to handle EPERM on Windows (child process
 * may still be holding the temp directory open).
 */
function rmRetry(dir: string, retries = 5, delayMs = 500): void {
  for (let i = 0; i < retries; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err: any) {
      if (i < retries - 1) {
        // Busy-wait a short while before retrying
        const start = Date.now();
        while (Date.now() - start < delayMs) {
          // no-op
        }
      } else {
        // Last attempt: on Windows, a timed-out child process may still hold
        // the directory. Swallow EPERM so the test can still pass.
        if (err.code !== 'EPERM') {
          throw err;
        }
        // Directory could not be removed — leak is acceptable in test
      }
    }
  }
}

describe('TestRunner', () => {
  let workingDir: string;

  beforeEach(() => {
    workingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-runner-'));
  });

  afterEach(() => {
    rmRetry(workingDir);
  });

  it('should run a passing test and return exitCode 0 with stdout', async () => {
    const runner = createTestRunner();
    const result = await runner.run(
      workingDir,
      'node -e "console.log(\'all tests passed\')"',
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('all tests passed');
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('should run a failing test and return non-zero exitCode', async () => {
    const runner = createTestRunner();
    const result = await runner.run(
      workingDir,
      'node -e "console.error(\'test failed\'); process.exit(1)"',
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('test failed');
  });

  it('should measure duration as a non-zero value', async () => {
    const runner = createTestRunner();
    const result = await runner.run(
      workingDir,
      'node -e "console.log(\'done\')"',
    );

    expect(result.durationMs).toBeGreaterThan(0);
    expect(typeof result.durationMs).toBe('number');
  });

  it('should use a custom command when provided', async () => {
    const runner = createTestRunner();
    const result = await runner.run(
      workingDir,
      'node -e "console.log(\'custom-command-output\')"',
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('custom-command-output');
  });

  it('should default to npm test when no command is provided', async () => {
    // Create a minimal package.json with a test script so npm test works
    const packageJson = {
      name: 'test-pkg',
      version: '1.0.0',
      scripts: {
        test: 'node -e "console.log(\'default-test-ran\')"',
      },
    };
    fs.writeFileSync(
      path.join(workingDir, 'package.json'),
      JSON.stringify(packageJson),
    );

    const runner = createTestRunner();
    const result = await runner.run(workingDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('default-test-ran');
  });

  it('should capture stderr correctly', async () => {
    const runner = createTestRunner();
    const result = await runner.run(
      workingDir,
      'node -e "console.error(\'stderr-message\')"',
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('stderr-message');
    expect(result.stdout).toBe('');
  });

  it('should capture both stdout and stderr in the same run', async () => {
    const runner = createTestRunner();
    const result = await runner.run(
      workingDir,
      'node -e "console.log(\'out\'); console.error(\'err\')"',
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('out');
    expect(result.stderr).toContain('err');
  });

  it('should execute in the specified working directory', async () => {
    // Create a marker file in the working directory
    const markerFile = path.join(workingDir, 'marker.txt');
    fs.writeFileSync(markerFile, 'workspace-content');

    const runner = createTestRunner();
    const result = await runner.run(
      workingDir,
      'node -e "console.log(require(\'fs\').readFileSync(\'marker.txt\', \'utf-8\').trim())"',
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('workspace-content');
  });
});