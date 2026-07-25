import { describe, it, expect } from 'vitest';
import { createResultParser, ParserPlugin, jestPlugin } from '../../src/feedback/result-parser.js';
import { TestFailure } from '../../src/types.js';

// ── Jest output fixture ──

const jestOutput = `● add function › should correctly add two numbers

    Expected: 5
    Received: 4

      at Object.<anonymous> (src/__tests__/add.test.ts:5:18)`;

// ── Vitest output fixture ──

const vitestOutput = ` FAIL  src/__tests__/add.test.ts > add function > should correctly add two numbers
AssertionError: expected 4 to be 5 // Object.is equality

- Expected
+ Received

- 5
+ 4

 ❯ src/__tests__/add.test.ts:5:18`;

// ── Unknown format fixture ──

const unknownOutput = 'Some random output that no parser recognizes';

// ── Custom plugin fixture ──

const customPlugin: ParserPlugin = {
  name: 'custom',
  canParse(stdout: string): boolean {
    return stdout.includes('[CUSTOM_FAIL]');
  },
  parse(stdout: string, _stderr: string): TestFailure[] {
    return [{
      file: 'custom/file.ts',
      line: 42,
      type: 'runtime',
      message: 'Custom failure',
      diff: stdout,
    }];
  },
};

describe('ResultParser Plugins', () => {
  describe('Jest output → JestPlugin parses', () => {
    it('should parse Jest output using the built-in JestPlugin', () => {
      const parser = createResultParser();

      const failures = parser.parse(jestOutput, '', 1);

      expect(failures).toHaveLength(1);
      expect(failures[0].file).toBe('src/__tests__/add.test.ts');
      expect(failures[0].line).toBe(5);
      expect(failures[0].type).toBe('assertion');
      expect(failures[0].message).toBe('add function › should correctly add two numbers');
      expect(failures[0].diff).toContain('Expected: 5');
      expect(failures[0].diff).toContain('Received: 4');
    });
  });

  describe('Vitest output → VitestPlugin parses', () => {
    it('should parse Vitest output using the built-in VitestPlugin', () => {
      const parser = createResultParser();

      const failures = parser.parse(vitestOutput, '', 1);

      expect(failures).toHaveLength(1);
      expect(failures[0].file).toBe('src/__tests__/add.test.ts');
      expect(failures[0].line).toBe(5);
      expect(failures[0].type).toBe('assertion');
      expect(failures[0].message).toBe('add function > should correctly add two numbers');
    });
  });

  describe('Unknown format → returns empty array (no crash)', () => {
    it('should return empty array for unrecognized output', () => {
      const parser = createResultParser();

      const failures = parser.parse(unknownOutput, '', 1);

      expect(failures).toHaveLength(0);
    });

    it('should return empty array for empty string', () => {
      const parser = createResultParser();

      const failures = parser.parse('', '', 1);

      expect(failures).toHaveLength(0);
    });
  });

  describe('Custom plugin can be registered', () => {
    it('should use custom plugin when provided', () => {
      const parser = createResultParser([customPlugin]);

      const failures = parser.parse('[CUSTOM_FAIL] Something went wrong', '', 1);

      expect(failures).toHaveLength(1);
      expect(failures[0].file).toBe('custom/file.ts');
      expect(failures[0].line).toBe(42);
      expect(failures[0].type).toBe('runtime');
      expect(failures[0].message).toBe('Custom failure');
    });

    it('should fall back to next plugin when custom plugin does not match', () => {
      // Custom plugin first, then Jest as fallback
      const parser = createResultParser([customPlugin, jestPlugin]);

      const failures = parser.parse(jestOutput, '', 1);

      // Custom plugin rejects (no [CUSTOM_FAIL]), JestPlugin picks it up
      expect(failures).toHaveLength(1);
      expect(failures[0].file).toBe('src/__tests__/add.test.ts');
      expect(failures[0].type).toBe('assertion');
    });

    it('should return empty array when no plugin matches', () => {
      // Only custom plugin, no default fallbacks
      const parser = createResultParser([customPlugin]);

      const failures = parser.parse(jestOutput, '', 1);

      // Custom plugin rejects (no [CUSTOM_FAIL]), no fallback → empty
      expect(failures).toHaveLength(0);
    });
  });

  describe('isPassed', () => {
    it('should return true for exitCode 0 regardless of plugins', () => {
      const parser = createResultParser();
      expect(parser.isPassed(0)).toBe(true);
    });

    it('should return false for non-zero exitCode', () => {
      const parser = createResultParser();
      expect(parser.isPassed(1)).toBe(false);
      expect(parser.isPassed(2)).toBe(false);
    });
  });
});