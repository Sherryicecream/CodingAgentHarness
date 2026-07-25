import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSearchCodeTool } from '../../src/tools/search-code.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('search_code tool', () => {
  let workspaceRoot: string;

  function createWorkspace(): void {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
    // Create a test file
    fs.writeFileSync(path.join(workspaceRoot, 'app.ts'), 'const hello = "world";\nfunction greet() {}\nconsole.log(hello);');
    fs.writeFileSync(path.join(workspaceRoot, 'utils.js'), 'const util = "helper";\nfunction doStuff() {}\nconsole.log(util);');
    // Create a subdirectory with files
    const subDir = path.join(workspaceRoot, 'subdir');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, 'nested.ts'), 'const nested = "value";\nfunction inner() {}\nconsole.log(nested);');
    // Create node_modules (should be ignored)
    const nmDir = path.join(workspaceRoot, 'node_modules');
    fs.mkdirSync(nmDir);
    fs.writeFileSync(path.join(nmDir, 'ignored.ts'), 'const ignored = "should not appear";');
    // Create .git directory (should be ignored)
    const gitDir = path.join(workspaceRoot, '.git');
    fs.mkdirSync(gitDir);
    fs.writeFileSync(path.join(gitDir, 'config.ts'), 'const gitConfig = "ignored";');
  }

  function cleanupWorkspace(): void {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }

  describe('basic search', () => {
    beforeEach(() => createWorkspace());
    afterEach(() => cleanupWorkspace());

    it('should find matches for an existing pattern', async () => {
      const tool = createSearchCodeTool(workspaceRoot);
      const result = await tool.execute({ pattern: 'console\\.log' });

      expect(result.success).toBe(true);
      const matches = JSON.parse(result.output);
      expect(matches.length).toBeGreaterThan(0);
      // All matches should contain "console.log"
      for (const match of matches) {
        expect(match.content).toMatch(/console\.log/);
        expect(match.file).toBeDefined();
        expect(match.line).toBeGreaterThan(0);
      }
    });

    it('should return empty array for a non-matching pattern', async () => {
      const tool = createSearchCodeTool(workspaceRoot);
      const result = await tool.execute({ pattern: 'NONEXISTENT_PATTERN_XYZ' });

      expect(result.success).toBe(true);
      const matches = JSON.parse(result.output);
      expect(matches).toEqual([]);
    });

    it('should return matches with correct structure (file, line, content)', async () => {
      const tool = createSearchCodeTool(workspaceRoot);
      const result = await tool.execute({ pattern: 'function' });

      expect(result.success).toBe(true);
      const matches = JSON.parse(result.output);
      expect(matches.length).toBeGreaterThan(0);
      for (const match of matches) {
        expect(match).toHaveProperty('file');
        expect(match).toHaveProperty('line');
        expect(match).toHaveProperty('content');
        expect(typeof match.file).toBe('string');
        expect(typeof match.line).toBe('number');
        expect(typeof match.content).toBe('string');
      }
    });
  });

  describe('file type filtering', () => {
    beforeEach(() => createWorkspace());
    afterEach(() => cleanupWorkspace());

    it('should only search .ts files when fileTypes is ".ts"', async () => {
      const tool = createSearchCodeTool(workspaceRoot);
      const result = await tool.execute({ pattern: 'console\\.log', fileTypes: '.ts' });

      expect(result.success).toBe(true);
      const matches: Array<{ file: string }> = JSON.parse(result.output);
      expect(matches.length).toBeGreaterThan(0);
      for (const match of matches) {
        expect(match.file).toMatch(/\.ts$/);
      }
    });

    it('should only search .js files when fileTypes is ".js"', async () => {
      const tool = createSearchCodeTool(workspaceRoot);
      const result = await tool.execute({ pattern: 'console\\.log', fileTypes: '.js' });

      expect(result.success).toBe(true);
      const matches: Array<{ file: string }> = JSON.parse(result.output);
      expect(matches.length).toBeGreaterThan(0);
      for (const match of matches) {
        expect(match.file).toMatch(/\.js$/);
      }
    });

    it('should search multiple file types', async () => {
      const tool = createSearchCodeTool(workspaceRoot);
      const result = await tool.execute({ pattern: 'console\\.log', fileTypes: '.ts,.js' });

      expect(result.success).toBe(true);
      const matches: Array<{ file: string }> = JSON.parse(result.output);
      expect(matches.length).toBeGreaterThan(0);
      for (const match of matches) {
        expect(match.file).toMatch(/\.(ts|js)$/);
      }
    });

    it('should return empty when no files match the file type', async () => {
      const tool = createSearchCodeTool(workspaceRoot);
      const result = await tool.execute({ pattern: 'console\\.log', fileTypes: '.py' });

      expect(result.success).toBe(true);
      const matches = JSON.parse(result.output);
      expect(matches).toEqual([]);
    });
  });

  describe('exclusion of node_modules and .git', () => {
    beforeEach(() => createWorkspace());
    afterEach(() => cleanupWorkspace());

    it('should not search inside node_modules', async () => {
      const tool = createSearchCodeTool(workspaceRoot);
      const result = await tool.execute({ pattern: 'ignored' });

      expect(result.success).toBe(true);
      const matches: Array<{ file: string }> = JSON.parse(result.output);
      // No matches should have node_modules in the path
      for (const match of matches) {
        expect(match.file).not.toContain('node_modules');
      }
    });

    it('should not search inside .git', async () => {
      const tool = createSearchCodeTool(workspaceRoot);
      const result = await tool.execute({ pattern: 'ignored' });

      expect(result.success).toBe(true);
      const matches: Array<{ file: string }> = JSON.parse(result.output);
      // No matches should have .git in the path
      for (const match of matches) {
        expect(match.file).not.toContain('.git');
      }
    });
  });

  describe('subdirectory search', () => {
    beforeEach(() => createWorkspace());
    afterEach(() => cleanupWorkspace());

    it('should search only within the specified subdirectory', async () => {
      const tool = createSearchCodeTool(workspaceRoot);
      const result = await tool.execute({ pattern: 'nested', path: 'subdir' });

      expect(result.success).toBe(true);
      const matches: Array<{ file: string }> = JSON.parse(result.output);
      expect(matches.length).toBeGreaterThan(0);
      for (const match of matches) {
        expect(match.file).toContain('subdir');
      }
    });

    it('should return an error for a non-existent subdirectory', async () => {
      const tool = createSearchCodeTool(workspaceRoot);
      const result = await tool.execute({ pattern: 'test', path: 'nonexistent' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Directory not found');
    });

    it('should block path traversal via subdirectory path', async () => {
      const tool = createSearchCodeTool(workspaceRoot);
      const result = await tool.execute({ pattern: 'test', path: '../../../etc' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Access denied');
    });
  });

  describe('risk level', () => {
    beforeEach(() => createWorkspace());
    afterEach(() => cleanupWorkspace());

    it('should have risk level "safe"', () => {
      const tool = createSearchCodeTool(workspaceRoot);
      expect(tool.riskLevel).toBe('safe');
    });
  });

  describe('invalid regex pattern', () => {
    beforeEach(() => createWorkspace());
    afterEach(() => cleanupWorkspace());

    it('should return an error for an invalid regex pattern', async () => {
      const tool = createSearchCodeTool(workspaceRoot);
      const result = await tool.execute({ pattern: '[' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Invalid regex pattern');
    });
  });
});