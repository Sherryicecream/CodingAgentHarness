import { describe, it, expect } from 'vitest';
import { createResultParser } from '../../src/feedback/result-parser.js';

const jestFailure = `● add function › should correctly add two numbers

    expect(received).toBe(expected)

    Expected: 5
    Received: 4

      3 | test('adds 1 + 2', () => {
      4 |   const result = add(1, 2);
    > 5 |   expect(result).toBe(5);
        |                  ^
      6 | });

      at Object.<anonymous> (src/__tests__/add.test.ts:5:18)`;

const jestSyntaxError = `● syntax error test › should fail on bad syntax

    SyntaxError: Unexpected token ')'

      at Object.<anonymous> (src/__tests__/syntax.test.ts:3:10)`;

const jestTimeout = `● timeout test › should fail on timeout

    Timeout - Async callback was not invoked within the 5000 ms timeout specified by jest.setTimeout.

      at Object.<anonymous> (src/__tests__/timeout.test.ts:10:1)`;

const jestAssertion = `● assertion test › should fail on assert

    expect(received).toEqual(expected)

    Expected: { "a": 1, "b": 2 }
    Received: { "a": 1 }

    at Object.<anonymous> (src/__tests__/assertion.test.ts:8:12)`;

const jestRuntime = `● runtime test › should throw runtime error

    TypeError: Cannot read properties of undefined (reading 'foo')

    at Object.<anonymous> (src/__tests__/runtime.test.ts:4:22)`;

const multipleFailures = `● test one › should fail first

    Expected: 1
    Received: 2

    at Object.<anonymous> (src/__tests__/one.test.ts:1:10)

● test two › should fail second

    Expected: "hello"
    Received: "world"

    at Object.<anonymous> (src/__tests__/two.test.ts:2:20)`;

describe('ResultParser', () => {
  const parser = createResultParser();

  describe('parse', () => {
    it('should extract file, line, type, and diff from a Jest failure', () => {
      const failures = parser.parse(jestFailure, '', 1);

      expect(failures).toHaveLength(1);
      expect(failures[0].file).toBe('src/__tests__/add.test.ts');
      expect(failures[0].line).toBe(5);
      expect(failures[0].type).toBe('assertion');
      expect(failures[0].diff).toContain('Expected: 5');
      expect(failures[0].diff).toContain('Received: 4');
      expect(failures[0].message).toBe('add function › should correctly add two numbers');
    });

    it('should return multiple TestFailure entries for multiple failures', () => {
      const failures = parser.parse(multipleFailures, '', 1);

      expect(failures).toHaveLength(2);
      expect(failures[0].file).toBe('src/__tests__/one.test.ts');
      expect(failures[0].line).toBe(1);
      expect(failures[0].message).toBe('test one › should fail first');

      expect(failures[1].file).toBe('src/__tests__/two.test.ts');
      expect(failures[1].line).toBe(2);
      expect(failures[1].message).toBe('test two › should fail second');
    });

    it('should detect SyntaxError and classify as "syntax"', () => {
      const failures = parser.parse(jestSyntaxError, '', 1);

      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('syntax');
      expect(failures[0].file).toBe('src/__tests__/syntax.test.ts');
      expect(failures[0].line).toBe(3);
    });

    it('should detect Timeout and classify as "timeout"', () => {
      const failures = parser.parse(jestTimeout, '', 1);

      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('timeout');
      expect(failures[0].file).toBe('src/__tests__/timeout.test.ts');
      expect(failures[0].line).toBe(10);
    });

    it('should detect assertion failure and classify as "assertion"', () => {
      const failures = parser.parse(jestAssertion, '', 1);

      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('assertion');
      expect(failures[0].file).toBe('src/__tests__/assertion.test.ts');
      expect(failures[0].line).toBe(8);
    });

    it('should classify runtime errors as "runtime"', () => {
      const failures = parser.parse(jestRuntime, '', 1);

      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('runtime');
      expect(failures[0].file).toBe('src/__tests__/runtime.test.ts');
      expect(failures[0].line).toBe(4);
    });

    it('should return empty array for empty output with exitCode 1', () => {
      const failures = parser.parse('', '', 1);

      expect(failures).toHaveLength(0);
    });

    it('should handle stderr containing failure output', () => {
      const failures = parser.parse('', jestFailure, 1);

      expect(failures).toHaveLength(1);
      expect(failures[0].file).toBe('src/__tests__/add.test.ts');
      expect(failures[0].type).toBe('assertion');
    });

    it('should handle blocks without a file match gracefully', () => {
      const badOutput = '● some test without stack trace\n\n    Some error message';

      const failures = parser.parse(badOutput, '', 1);

      expect(failures).toHaveLength(1);
      expect(failures[0].file).toBe('unknown');
      expect(failures[0].line).toBe(0);
      expect(failures[0].message).toBe('some test without stack trace');
    });
  });

  describe('isPassed', () => {
    it('should return true for exitCode 0', () => {
      expect(parser.isPassed(0)).toBe(true);
    });

    it('should return false for exitCode 1', () => {
      expect(parser.isPassed(1)).toBe(false);
    });

    it('should return false for any non-zero exitCode', () => {
      expect(parser.isPassed(2)).toBe(false);
      expect(parser.isPassed(255)).toBe(false);
      expect(parser.isPassed(-1)).toBe(false);
    });
  });
});