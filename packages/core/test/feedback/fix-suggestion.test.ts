import { describe, it, expect } from 'vitest';
import { createFixSuggestionBuilder } from '../../src/feedback/fix-suggestion.js';
import { ClassifiedFailure } from '../../src/feedback/failure-classifier.js';
import { TestFailure } from '../../src/types.js';

function makeFailure(type: TestFailure['type'], overrides?: Partial<TestFailure>): TestFailure {
  return {
    file: `src/__tests__/${type}.test.ts`,
    line: 1,
    type,
    message: `${type} error occurred`,
    diff: 'Expected: x\nReceived: y',
    ...overrides,
  };
}

function makeClassified(
  type: TestFailure['type'],
  priority: ClassifiedFailure['priority'],
  overrides?: Partial<TestFailure>,
): ClassifiedFailure {
  return {
    failure: makeFailure(type, overrides),
    category: type,
    priority,
  };
}

describe('FixSuggestionBuilder', () => {
  const builder = createFixSuggestionBuilder();

  describe('build', () => {
    it('single syntax failure → generates fix suggestion with file+line', () => {
      const failures: ClassifiedFailure[] = [
        makeClassified('syntax', 'high', { file: 'src/app.ts', line: 42 }),
      ];

      const suggestion = builder.build(failures);

      expect(suggestion.summary).toBe('1 test failure(s) detected.');
      expect(suggestion.failures).toHaveLength(1);
      expect(suggestion.failures[0].file).toBe('src/app.ts');
      expect(suggestion.failures[0].line).toBe(42);
      expect(suggestion.failures[0].type).toBe('syntax');
      expect(suggestion.suggestedActions).toHaveLength(1);
      expect(suggestion.suggestedActions[0]).toContain('src/app.ts:42');
      expect(suggestion.suggestedActions[0]).toContain('[high]');
    });

    it('multiple assertion failures → summarizes all diffs', () => {
      const failures: ClassifiedFailure[] = [
        makeClassified('assertion', 'medium', {
          file: 'src/math.test.ts',
          line: 10,
          diff: 'Expected: 2\nReceived: 3',
        }),
        makeClassified('assertion', 'medium', {
          file: 'src/string.test.ts',
          line: 20,
          diff: 'Expected: "hello"\nReceived: "world"',
        }),
      ];

      const suggestion = builder.build(failures);

      expect(suggestion.summary).toBe('2 test failure(s) detected.');
      expect(suggestion.failures).toHaveLength(2);
      expect(suggestion.failures[0].diff).toBe('Expected: 2\nReceived: 3');
      expect(suggestion.failures[1].diff).toBe('Expected: "hello"\nReceived: "world"');
      expect(suggestion.suggestedActions).toHaveLength(2);
    });

    it('toContextString() → correct format with file path, line, diff', () => {
      const failures: ClassifiedFailure[] = [
        makeClassified('syntax', 'high', {
          file: 'src/app.ts',
          line: 42,
          message: 'Unexpected token',
          diff: 'Line 42: const x = ;',
        }),
      ];

      const suggestion = builder.build(failures);
      const contextStr = builder.toContextString(suggestion);

      expect(contextStr).toContain('File: src/app.ts:42');
      expect(contextStr).toContain('Error: Unexpected token');
      expect(contextStr).toContain('Type: syntax');
      expect(contextStr).toContain('Diff:');
      expect(contextStr).toContain('Line 42: const x = ;');
      expect(contextStr).toContain('---');
      expect(contextStr).toContain('Fix the issues in priority order shown above.');
    });

    it('empty failure list → summary is "All tests passed"', () => {
      const failures: ClassifiedFailure[] = [];

      const suggestion = builder.build(failures);

      expect(suggestion.summary).toBe('All tests passed.');
      expect(suggestion.failures).toHaveLength(0);
      expect(suggestion.suggestedActions).toHaveLength(0);
    });

    it('suggested actions are sorted by priority', () => {
      const failures: ClassifiedFailure[] = [
        makeClassified('timeout', 'low', { file: 'timeout.test.ts' }),
        makeClassified('syntax', 'high', { file: 'syntax.test.ts' }),
        makeClassified('assertion', 'medium', { file: 'assertion.test.ts' }),
        makeClassified('runtime', 'medium', { file: 'runtime.test.ts' }),
      ];

      const suggestion = builder.build(failures);

      // First action should be high priority
      expect(suggestion.suggestedActions[0]).toContain('[high]');
      expect(suggestion.suggestedActions[0]).toContain('syntax.test.ts');

      // Medium priorities follow
      expect(suggestion.suggestedActions[1]).toContain('[medium]');
      expect(suggestion.suggestedActions[2]).toContain('[medium]');

      // Low priority last
      expect(suggestion.suggestedActions[3]).toContain('[low]');
      expect(suggestion.suggestedActions[3]).toContain('timeout.test.ts');
    });

    it('FixSuggestion contains correct number of failures', () => {
      const failures: ClassifiedFailure[] = [
        makeClassified('syntax', 'high'),
        makeClassified('assertion', 'medium'),
        makeClassified('runtime', 'medium'),
      ];

      const suggestion = builder.build(failures);

      expect(suggestion.failures).toHaveLength(3);
      expect(suggestion.suggestedActions).toHaveLength(3);
    });

    it('build does not mutate the input array', () => {
      const failures: ClassifiedFailure[] = [
        makeClassified('timeout', 'low'),
        makeClassified('syntax', 'high'),
      ];

      const originalOrder = [...failures];
      builder.build(failures);

      expect(failures[0].failure.type).toBe(originalOrder[0].failure.type);
      expect(failures[1].failure.type).toBe(originalOrder[1].failure.type);
    });
  });

  describe('toContextString', () => {
    it('empty suggestion → returns summary string', () => {
      const suggestion = builder.build([]);

      const contextStr = builder.toContextString(suggestion);

      expect(contextStr).toBe('All tests passed. No fixes needed.');
    });

    it('single failure → contains failure separator', () => {
      const failures: ClassifiedFailure[] = [
        makeClassified('runtime', 'medium', { file: 'src/runner.ts', line: 15 }),
      ];

      const suggestion = builder.build(failures);
      const contextStr = builder.toContextString(suggestion);

      expect(contextStr).toContain('---');
      expect(contextStr).toContain('The following tests failed');
    });

    it('multiple failures → each failure is separated by ---', () => {
      const failures: ClassifiedFailure[] = [
        makeClassified('syntax', 'high'),
        makeClassified('assertion', 'medium'),
      ];

      const suggestion = builder.build(failures);
      const contextStr = builder.toContextString(suggestion);

      const separatorCount = (contextStr.match(/---/g) || []).length;
      expect(separatorCount).toBe(2);
    });
  });
});