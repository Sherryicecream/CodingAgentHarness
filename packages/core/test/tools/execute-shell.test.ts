import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createExecuteShellTool } from '../../src/tools/execute-shell.js';
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

describe('execute_shell tool', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-shell-test-'));
  });

  afterEach(() => {
    rmRetry(workspaceRoot);
  });

  it('should execute echo hello and capture stdout', async () => {
    const tool = createExecuteShellTool(workspaceRoot);
    const result = await tool.execute({ command: 'node -e "console.log(\'hello\')"' });

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.stdout).toContain('hello');
    expect(parsed.exitCode).toBe(0);
  });

  it('should return success: false for a failing command with non-zero exit code', async () => {
    const tool = createExecuteShellTool(workspaceRoot);
    const result = await tool.execute({ command: 'node -e "process.exit(1)"' });

    expect(result.success).toBe(false);
    const parsed = JSON.parse(result.output);
    expect(parsed.exitCode).toBe(1);
    expect(result.error).toBeDefined();
  });

  it('should timeout when command exceeds the configured timeout', async () => {
    // Create a tool with a very short timeout (500ms)
    const tool = createExecuteShellTool(workspaceRoot, { timeout: 500 });
    // Run a command that sleeps for 5 seconds, which should be killed
    const result = await tool.execute({
      command: 'node -e "setTimeout(() => {}, 5000)"',
    });

    const parsed = JSON.parse(result.output);

    expect(result.success).toBe(false);
    expect(parsed.exitCode === null || parsed.exitCode !== 0).toBe(true);
    expect(result.error).toBeDefined();

    // execute() must not resolve while a timed-out descendant still holds cwd.
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    expect(fs.existsSync(workspaceRoot)).toBe(false);
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-shell-test-'));
  });

  it('should have risk level "moderate"', () => {
    const tool = createExecuteShellTool(workspaceRoot);
    expect(tool.riskLevel).toBe('moderate');
  });

  it('should capture stderr output', async () => {
    const tool = createExecuteShellTool(workspaceRoot);
    const result = await tool.execute({
      command: 'node -e "console.error(\'error message\')"',
    });

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.stderr).toContain('error message');
    expect(parsed.exitCode).toBe(0);
  });

  it('should execute commands in the specified workspaceRoot', async () => {
    // Create a file in the workspace root
    const markerFile = path.join(workspaceRoot, 'marker.txt');
    fs.writeFileSync(markerFile, 'workspace-content');

    const tool = createExecuteShellTool(workspaceRoot);

    // Use node to read the file from the current working directory
    const result = await tool.execute({
      command: 'node -e "console.log(require(\'fs\').readFileSync(\'marker.txt\', \'utf-8\').trim())"',
    });

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.stdout).toContain('workspace-content');
  });

  it('should use default 30s timeout when no options provided', async () => {
    const tool = createExecuteShellTool(workspaceRoot);
    const result = await tool.execute({
      command: 'node -e "console.log(\'quick\')"',
    });

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.stdout).toBe('quick');
  });
});
