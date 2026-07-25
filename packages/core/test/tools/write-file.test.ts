import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createWriteFileTool } from '../../src/tools/write-file.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('write_file tool', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('should write a new file and return success', async () => {
    const tool = createWriteFileTool(workspaceRoot);
    const result = await tool.execute({ path: 'newfile.txt', content: 'hello world' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('File written');

    const writtenContent = fs.readFileSync(path.join(workspaceRoot, 'newfile.txt'), 'utf-8');
    expect(writtenContent).toBe('hello world');
  });

  it('should overwrite an existing file', async () => {
    const existingPath = path.join(workspaceRoot, 'existing.txt');
    fs.writeFileSync(existingPath, 'original content');

    const tool = createWriteFileTool(workspaceRoot);
    const result = await tool.execute({ path: 'existing.txt', content: 'updated content' });

    expect(result.success).toBe(true);
    const writtenContent = fs.readFileSync(existingPath, 'utf-8');
    expect(writtenContent).toBe('updated content');
  });

  it('should block path traversal via ../', async () => {
    const tool = createWriteFileTool(workspaceRoot);
    const result = await tool.execute({ path: '../../../etc/malicious.txt', content: 'evil' });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Access denied');
  });

  it('should block writing to .git/config', async () => {
    const tool = createWriteFileTool(workspaceRoot);
    const result = await tool.execute({ path: '.git/config', content: 'malicious git config' });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Access denied');
    expect(result.error).toContain('.git');
  });

  it('should block writing to .git/hooks/pre-commit', async () => {
    const tool = createWriteFileTool(workspaceRoot);
    const result = await tool.execute({ path: '.git/hooks/pre-commit', content: 'malicious hook' });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Access denied');
    expect(result.error).toContain('.git');
  });

  it('should have risk level "moderate"', () => {
    const tool = createWriteFileTool(workspaceRoot);
    expect(tool.riskLevel).toBe('moderate');
  });

  it('should create parent directories automatically', async () => {
    const tool = createWriteFileTool(workspaceRoot);
    const result = await tool.execute({ path: 'a/b/c/deep.txt', content: 'deep content' });

    expect(result.success).toBe(true);

    const deepPath = path.join(workspaceRoot, 'a', 'b', 'c', 'deep.txt');
    expect(fs.existsSync(deepPath)).toBe(true);
    const writtenContent = fs.readFileSync(deepPath, 'utf-8');
    expect(writtenContent).toBe('deep content');
  });

  it('should write to a nested subdirectory correctly', async () => {
    // Create the subdirectory manually first
    const subDir = path.join(workspaceRoot, 'subdir');
    fs.mkdirSync(subDir);

    const tool = createWriteFileTool(workspaceRoot);
    const result = await tool.execute({ path: 'subdir/nested.txt', content: 'nested content' });

    expect(result.success).toBe(true);
    const nestedPath = path.join(workspaceRoot, 'subdir', 'nested.txt');
    const writtenContent = fs.readFileSync(nestedPath, 'utf-8');
    expect(writtenContent).toBe('nested content');
  });

  it('should block path traversal with absolute path outside workspace', async () => {
    const tool = createWriteFileTool(workspaceRoot);
    const absPath = os.platform() === 'win32'
      ? 'C:\\Windows\\Temp\\outside.txt'
      : '/tmp/outside.txt';
    const result = await tool.execute({ path: absPath, content: 'should not write' });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Access denied');
  });

  it('should block writing to a .git directory nested inside a subdirectory', async () => {
    const tool = createWriteFileTool(workspaceRoot);
    const result = await tool.execute({ path: 'subdir/.git/HEAD', content: 'malicious' });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Access denied');
  });

  it('should return error for invalid path (e.g., empty string)', async () => {
    const tool = createWriteFileTool(workspaceRoot);
    const result = await tool.execute({ path: '', content: 'test' });

    // resolve('') is the same as resolve('.') which is the workspace root
    // so it should fail because it's a directory, not a file
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});