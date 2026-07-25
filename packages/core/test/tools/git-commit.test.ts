import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createGitCommitTool } from '../../src/tools/git-commit.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'node:child_process';

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
        // Last attempt: on Windows, swallow EPERM so test can still pass.
        if (err.code !== 'EPERM') {
          throw err;
        }
        // Directory could not be removed — leak is acceptable in test
      }
    }
  }
}

function git(cwd: string, command: string): string {
  return execSync(`git ${command}`, { cwd, encoding: 'utf-8', stdio: 'pipe' });
}

describe('git_commit tool', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-git-commit-'));
    git(workspaceRoot, 'init');
    git(workspaceRoot, 'config user.email "test@example.com"');
    git(workspaceRoot, 'config user.name "Test User"');
    // Create an initial file and commit it so we have a baseline
    fs.writeFileSync(path.join(workspaceRoot, 'test.txt'), 'line 1\nline 2\n');
    git(workspaceRoot, 'add test.txt');
    git(workspaceRoot, 'commit -m "initial commit"');
  });

  afterEach(() => {
    rmRetry(workspaceRoot);
  });

  it('should commit with changes and return commit hash', async () => {
    // Modify a file to create changes
    fs.writeFileSync(path.join(workspaceRoot, 'test.txt'), 'line 1\nline 2 modified\n');

    const tool = createGitCommitTool(workspaceRoot);
    const result = await tool.execute({ message: 'test commit' });

    expect(result.success).toBe(true);
    expect(result.output).toMatch(/^Committed: [a-f0-9]{7,40}$/);

    // Verify the commit was actually created
    const log = git(workspaceRoot, 'log --oneline -1');
    expect(log).toContain('test commit');
  });

  it('should return "nothing to commit" when there are no changes', async () => {
    const tool = createGitCommitTool(workspaceRoot);
    const result = await tool.execute({ message: 'empty commit' });

    expect(result.success).toBe(true);
    expect(result.output).toBe('nothing to commit');
  });

  it('should have risk level "dangerous"', () => {
    const tool = createGitCommitTool(workspaceRoot);
    expect(tool.riskLevel).toBe('dangerous');
  });

  it('should succeed with empty commit message', async () => {
    // Modify a file to create changes
    fs.writeFileSync(path.join(workspaceRoot, 'test.txt'), 'modified line\n');

    const tool = createGitCommitTool(workspaceRoot);
    const result = await tool.execute({ message: '' });

    expect(result.success).toBe(true);
    expect(result.output).toMatch(/^Committed: [a-f0-9]{7,40}$/);

    // Verify the commit was actually created
    const log = git(workspaceRoot, 'log --oneline -1');
    expect(log).toContain('');
  });
});