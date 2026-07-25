import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRunTestsTool } from '../../src/tools/run-tests.js';
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

describe('run_tests tool', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-run-tests-'));
  });

  afterEach(() => {
    rmRetry(workspaceRoot);
  });

  it('should run a passing test script and return success: true with exitCode 0', async () => {
    const tool = createRunTestsTool(workspaceRoot, {
      command: 'node -e "console.log(\'pass\')"',
    });
    const result = await tool.execute({});

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.stdout).toContain('pass');
    expect(parsed.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it('should run a failing test script and return success: false with non-zero exit code', async () => {
    const tool = createRunTestsTool(workspaceRoot, {
      command: 'node -e "process.exit(1)"',
    });
    const result = await tool.execute({});

    expect(result.success).toBe(false);
    const parsed = JSON.parse(result.output);
    expect(parsed.exitCode).toBe(1);
    expect(result.error).toContain('Tests failed with exit code 1');
  });

  it('should default to npm test command when no options provided', () => {
    const tool = createRunTestsTool(workspaceRoot);
    // The default command is baked into the definition description
    expect(tool.definition.description).toContain('Run the project test suite');
    expect(tool.definition.parameters).toHaveProperty('properties');
    const params = tool.definition.parameters as any;
    expect(params.properties.command.description).toContain('npm test');
  });

  it('should use custom command when provided in options', async () => {
    const tool = createRunTestsTool(workspaceRoot, {
      command: 'node -e "console.log(\'custom\')"',
    });
    const result = await tool.execute({});

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.stdout).toContain('custom');
  });

  it('should use command from params when provided at execution time', async () => {
    const tool = createRunTestsTool(workspaceRoot, {
      command: 'node -e "process.exit(1)"',
    });
    // Override with a passing command at execution time
    const result = await tool.execute({
      command: 'node -e "console.log(\'override\')"',
    });

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.stdout).toContain('override');
    expect(parsed.exitCode).toBe(0);
  });

  it('should have risk level "safe"', () => {
    const tool = createRunTestsTool(workspaceRoot);
    expect(tool.riskLevel).toBe('safe');
  });

  it('should capture stderr output', async () => {
    const tool = createRunTestsTool(workspaceRoot, {
      command: 'node -e "console.error(\'test error\')"',
    });
    const result = await tool.execute({});

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.stderr).toContain('test error');
  });

  it('should execute in the specified workspaceRoot', async () => {
    // Create a marker file in the workspace root
    const markerFile = path.join(workspaceRoot, 'marker.txt');
    fs.writeFileSync(markerFile, 'workspace-content');

    const tool = createRunTestsTool(workspaceRoot, {
      command: 'node -e "console.log(require(\'fs\').readFileSync(\'marker.txt\', \'utf-8\').trim())"',
    });
    const result = await tool.execute({});

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.stdout).toContain('workspace-content');
  });
});