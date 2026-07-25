import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createGitDiffTool } from '../../src/tools/git-diff.js';
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

describe('git_diff tool', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-git-diff-'));
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

  it('should return diff content when there are unstaged changes', async () => {
    // Modify the file to create unstaged changes
    fs.writeFileSync(path.join(workspaceRoot, 'test.txt'), 'line 1\nline 2 modified\n');

    const tool = createGitDiffTool(workspaceRoot);
    const result = await tool.execute({});

    expect(result.success).toBe(true);
    expect(result.output).toContain('line 2 modified');
    expect(result.output).toContain('diff --git');
  });

  it('should return empty string when there are no changes', async () => {
    const tool = createGitDiffTool(workspaceRoot);
    const result = await tool.execute({});

    expect(result.success).toBe(true);
    expect(result.output).toBe('');
  });

  it('should use --cached flag when staged=true', async () => {
    // Modify the file, stage it, but don't commit
    fs.writeFileSync(path.join(workspaceRoot, 'test.txt'), 'line 1\nline 2 staged\n');
    git(workspaceRoot, 'add test.txt');

    const tool = createGitDiffTool(workspaceRoot);

    // Unstaged diff should be empty (everything is staged)
    const unstagedResult = await tool.execute({});
    expect(unstagedResult.success).toBe(true);
    expect(unstagedResult.output).toBe('');

    // Staged diff should show the changes
    const stagedResult = await tool.execute({ staged: true });
    expect(stagedResult.success).toBe(true);
    expect(stagedResult.output).toContain('line 2 staged');
    expect(stagedResult.output).toContain('diff --git');
  });

  it('should return error when not a git repo', async () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-non-git-'));
    // Prevent git from traversing up to find a parent .git directory
    const prevCeiling = process.env.GIT_CEILING_DIRECTORIES;
    process.env.GIT_CEILING_DIRECTORIES = os.tmpdir();
    try {
      const tool = createGitDiffTool(nonGitDir);
      const result = await tool.execute({});

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/not a git repository/i);
    } finally {
      if (prevCeiling === undefined) {
        delete process.env.GIT_CEILING_DIRECTORIES;
      } else {
        process.env.GIT_CEILING_DIRECTORIES = prevCeiling;
      }
      rmRetry(nonGitDir);
    }
  });

  it('should have risk level "safe"', () => {
    const tool = createGitDiffTool(workspaceRoot);
    expect(tool.riskLevel).toBe('safe');
  });
});