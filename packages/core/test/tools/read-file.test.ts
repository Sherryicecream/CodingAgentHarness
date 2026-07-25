import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createReadFileTool } from '../../src/tools/read-file.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('read_file tool', () => {
  let workspaceRoot: string;
  let testFilePath: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
    testFilePath = path.join(workspaceRoot, 'test.txt');
    fs.writeFileSync(testFilePath, 'hello world');
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('should read an existing file and return its content', async () => {
    const tool = createReadFileTool(workspaceRoot);
    const result = await tool.execute({ path: 'test.txt' });

    expect(result.success).toBe(true);
    expect(result.output).toBe('hello world');
  });

  it('should return success: false for a non-existent file', async () => {
    const tool = createReadFileTool(workspaceRoot);
    const result = await tool.execute({ path: 'nonexistent.txt' });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Failed to read file');
  });

  it('should block path traversal via ../', async () => {
    const tool = createReadFileTool(workspaceRoot);
    const result = await tool.execute({ path: '../../../etc/passwd' });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Access denied');
  });

  it('should block path traversal with resolved absolute path', async () => {
    const tool = createReadFileTool(workspaceRoot);
    // Try to read /etc/passwd by passing an absolute path from outside the workspace
    const result = await tool.execute({ path: os.platform() === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/passwd' });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Access denied');
  });

  it('should have risk level "safe"', () => {
    const tool = createReadFileTool(workspaceRoot);
    expect(tool.riskLevel).toBe('safe');
  });

  it('should read a file in a subdirectory correctly', async () => {
    // Create a subdirectory with a file
    const subDir = path.join(workspaceRoot, 'subdir');
    fs.mkdirSync(subDir);
    const subFilePath = path.join(subDir, 'nested.txt');
    fs.writeFileSync(subFilePath, 'nested content');

    const tool = createReadFileTool(workspaceRoot);
    const result = await tool.execute({ path: 'subdir/nested.txt' });

    expect(result.success).toBe(true);
    expect(result.output).toBe('nested content');
  });

  it('should allow reading the workspace root itself (if it is a file, unlikely)', async () => {
    // This tests the edge case: resolved === resolvedRoot
    const tool = createReadFileTool(workspaceRoot);
    // Trying to read the root as a file should fail with a read error, not access denied
    const result = await tool.execute({ path: '.' });
    // On most systems, trying to read a directory as a file will throw an error
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // Should NOT be an access denied error — it should be a read error
    expect(result.error).not.toContain('Access denied');
    expect(result.error).toContain('Failed to read file');
  });
});