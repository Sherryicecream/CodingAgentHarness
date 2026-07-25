import { describe, it, expect } from 'vitest';
import { createFailureClassifier, ClassifiedFailure } from '../../src/feedback/failure-classifier.js';
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

describe('FailureClassifier', () => {
  const classifier = createFailureClassifier();

  describe('classify', () => {
    it('syntax error → priority high', () => {
      const failures: TestFailure[] = [makeFailure('syntax')];
      const result = classifier.classify(failures);

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('syntax');
      expect(result[0].priority).toBe('high');
      expect(result[0].failure.type).toBe('syntax');
    });

    it('assertion error → priority medium', () => {
      const failures: TestFailure[] = [makeFailure('assertion')];
      const result = classifier.classify(failures);

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('assertion');
      expect(result[0].priority).toBe('medium');
      expect(result[0].failure.type).toBe('assertion');
    });

    it('runtime error → priority medium', () => {
      const failures: TestFailure[] = [makeFailure('runtime')];
      const result = classifier.classify(failures);

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('runtime');
      expect(result[0].priority).toBe('medium');
      expect(result[0].failure.type).toBe('runtime');
    });

    it('timeout error → priority low', () => {
      const failures: TestFailure[] = [makeFailure('timeout')];
      const result = classifier.classify(failures);

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('timeout');
      expect(result[0].priority).toBe('low');
      expect(result[0].failure.type).toBe('timeout');
    });

    it('empty list → returns empty array', () => {
      const failures: TestFailure[] = [];
      const result = classifier.classify(failures);

      expect(result).toHaveLength(0);
      expect(result).toEqual([]);
    });

    it('category matches the failure type', () => {
      const allTypes: TestFailure['type'][] = ['syntax', 'assertion', 'timeout', 'runtime'];
      const failures: TestFailure[] = allTypes.map(t => makeFailure(t));

      const result = classifier.classify(failures);

      expect(result).toHaveLength(4);
      for (const classified of result) {
        expect(classified.category).toBe(classified.failure.type);
      }
    });

    it('should preserve the original failure object in each classified entry', () => {
      const original: TestFailure = {
        file: 'src/app.ts',
        line: 42,
        type: 'assertion',
        message: 'expected 1 to equal 2',
        diff: 'Expected: 2\nReceived: 1',
      };

      const result = classifier.classify([original]);

      expect(result[0].failure).toBe(original);
    });
  });

  describe('sortByPriority', () => {
    it('should sort multiple failures: high → medium → low', () => {
      const failures = classifier.classify([
        makeFailure('timeout'),
        makeFailure('syntax'),
        makeFailure('assertion'),
        makeFailure('runtime'),
      ]);

      const sorted = classifier.sortByPriority(failures);

      expect(sorted).toHaveLength(4);
      expect(sorted[0].priority).toBe('high');
      expect(sorted[1].priority).toBe('medium');
      expect(sorted[2].priority).toBe('medium');
      expect(sorted[3].priority).toBe('low');
      expect(sorted[0].category).toBe('syntax');
    });

    it('should return a new array without mutating the original', () => {
      const failures = classifier.classify([
        makeFailure('timeout'),
        makeFailure('syntax'),
      ]);

      const sorted = classifier.sortByPriority(failures);

      expect(sorted).not.toBe(failures);
      expect(failures[0].failure.type).toBe('timeout'); // original order preserved
      expect(failures[1].failure.type).toBe('syntax');
    });

    it('empty list → returns empty array', () => {
      const empty: ClassifiedFailure[] = [];
      const result = classifier.sortByPriority(empty);

      expect(result).toHaveLength(0);
      expect(result).toEqual([]);
    });

    it('single item → returns single item', () => {
      const failures = classifier.classify([makeFailure('syntax')]);
      const sorted = classifier.sortByPriority(failures);

      expect(sorted).toHaveLength(1);
      expect(sorted[0].priority).toBe('high');
    });

    it('should keep medium items in stable order before low items', () => {
      const failures = classifier.classify([
        makeFailure('runtime', { file: 'runtime-1.test.ts' }),
        makeFailure('timeout'),
        makeFailure('assertion', { file: 'assertion-1.test.ts' }),
        makeFailure('runtime', { file: 'runtime-2.test.ts' }),
      ]);

      const sorted = classifier.sortByPriority(failures);

      expect(sorted).toHaveLength(4);
      // All medium-priority items come before low
      expect(sorted[0].priority).toBe('medium');
      expect(sorted[1].priority).toBe('medium');
      expect(sorted[2].priority).toBe('medium');
      expect(sorted[3].priority).toBe('low');
    });
  });
});