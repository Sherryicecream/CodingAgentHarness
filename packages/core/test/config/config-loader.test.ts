import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConfigLoader, ConfigLoader, ConfigValidationError } from '../../src/config/config-loader.js';
import { AgentConfig } from '../../src/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('ConfigLoader', () => {
  let loader: ConfigLoader;
  let tempDir: string;

  beforeEach(() => {
    loader = createConfigLoader();
    tempDir = path.join(os.tmpdir(), `test-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('getDefaults', () => {
    it('should return default config', () => {
      const defaults = loader.getDefaults();
      expect(defaults.maxIterations).toBe(20);
      expect(defaults.testCommand).toBe('npm test');
      expect(defaults.allowedTools).toEqual(['*']);
      expect(defaults.blockedCommands).toContain('rm -rf');
      expect(defaults.blockedCommands).toContain('DROP TABLE');
      expect(defaults.ignoredPaths).toContain('node_modules');
    });

    it('should return a new object each time (no mutation)', () => {
      const d1 = loader.getDefaults();
      const d2 = loader.getDefaults();
      d1.maxIterations = 99;
      expect(d2.maxIterations).toBe(20);
    });
  });

  describe('load', () => {
    it('should return defaults when no config file exists', async () => {
      const config = await loader.load(tempDir);
      expect(config.maxIterations).toBe(20);
      expect(config.testCommand).toBe('npm test');
    });

    it('should merge user config overriding defaults', async () => {
      const harnessDir = path.join(tempDir, '.harness');
      fs.mkdirSync(harnessDir, { recursive: true });
      fs.writeFileSync(
        path.join(harnessDir, 'config.yaml'),
        'maxIterations: 10\ntestCommand: "npm run test:unit"\nallowedTools: ["read_file", "write_file"]\nblockedCommands: ["custom-block"]\nignoredPaths: ["custom-dir"]\n',
        'utf-8'
      );

      const config = await loader.load(tempDir);
      expect(config.maxIterations).toBe(10);
      expect(config.testCommand).toBe('npm run test:unit');
      expect(config.allowedTools).toEqual(['read_file', 'write_file']);
      expect(config.blockedCommands).toEqual(['custom-block']);
      expect(config.ignoredPaths).toEqual(['custom-dir']);
    });

    it('should throw ConfigValidationError for invalid config format', async () => {
      const harnessDir = path.join(tempDir, '.harness');
      fs.mkdirSync(harnessDir, { recursive: true });
      fs.writeFileSync(
        path.join(harnessDir, 'config.yaml'),
        'maxIterations: "not-a-number"\ntestCommand: 123\n',
        'utf-8'
      );

      await expect(loader.load(tempDir)).rejects.toThrow(ConfigValidationError);
    });

    it('should use defaults for missing fields in partial config', async () => {
      const harnessDir = path.join(tempDir, '.harness');
      fs.mkdirSync(harnessDir, { recursive: true });
      fs.writeFileSync(
        path.join(harnessDir, 'config.yaml'),
        'maxIterations: 5\n',
        'utf-8'
      );

      const config = await loader.load(tempDir);
      expect(config.maxIterations).toBe(5);
      // These should come from defaults
      expect(config.testCommand).toBe('npm test');
      expect(config.allowedTools).toEqual(['*']);
      expect(config.blockedCommands).toContain('rm -rf');
      expect(config.ignoredPaths).toContain('node_modules');
    });

    it('should throw ConfigValidationError for malformed YAML', async () => {
      const harnessDir = path.join(tempDir, '.harness');
      fs.mkdirSync(harnessDir, { recursive: true });
      fs.writeFileSync(
        path.join(harnessDir, 'config.yaml'),
        'maxIterations: [unclosed\n',
        'utf-8'
      );

      await expect(loader.load(tempDir)).rejects.toThrow(ConfigValidationError);
    });
  });

  describe('validate', () => {
    it('should return true for valid config', () => {
      const valid: AgentConfig = {
        maxIterations: 10,
        testCommand: 'npm test',
        allowedTools: ['*'],
        blockedCommands: ['rm -rf'],
        ignoredPaths: ['node_modules'],
      };
      expect(loader.validate(valid)).toBe(true);
    });

    it('should return false for non-object', () => {
      expect(loader.validate(null)).toBe(false);
      expect(loader.validate(undefined)).toBe(false);
      expect(loader.validate('string')).toBe(false);
      expect(loader.validate(42)).toBe(false);
    });

    it('should return false for missing required fields', () => {
      expect(loader.validate({ maxIterations: 10 })).toBe(false);
      expect(loader.validate({ testCommand: 'npm test' })).toBe(false);
      expect(loader.validate({})).toBe(false);
    });

    it('should return false for wrong types', () => {
      expect(
        loader.validate({
          maxIterations: 'ten',
          testCommand: 'npm test',
          allowedTools: ['*'],
          blockedCommands: ['rm -rf'],
          ignoredPaths: ['node_modules'],
        })
      ).toBe(false);

      expect(
        loader.validate({
          maxIterations: 10,
          testCommand: 'npm test',
          allowedTools: 'not-an-array',
          blockedCommands: ['rm -rf'],
          ignoredPaths: ['node_modules'],
        })
      ).toBe(false);
    });
  });
});