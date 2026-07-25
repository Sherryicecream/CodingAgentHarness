import { TestFailure } from '../types.js';

export type FailureCategory = 'syntax' | 'assertion' | 'timeout' | 'runtime';
export type FixPriority = 'high' | 'medium' | 'low';

export interface ClassifiedFailure {
  failure: TestFailure;
  category: FailureCategory;
  priority: FixPriority;
}

const PRIORITY_MAP: Record<FailureCategory, FixPriority> = {
  syntax: 'high',     // Location is clear, easiest to fix
  assertion: 'medium', // Needs logic understanding
  runtime: 'medium',   // Needs stack trace analysis
  timeout: 'low',      // May be performance issue, not logic error
};

const PRIORITY_ORDER: FixPriority[] = ['high', 'medium', 'low'];

export interface FailureClassifier {
  classify(failures: TestFailure[]): ClassifiedFailure[];
  sortByPriority(failures: ClassifiedFailure[]): ClassifiedFailure[];
}

export function createFailureClassifier(): FailureClassifier {
  return {
    classify(failures: TestFailure[]): ClassifiedFailure[] {
      return failures.map(failure => ({
        failure,
        category: failure.type,
        priority: PRIORITY_MAP[failure.type],
      }));
    },

    sortByPriority(failures: ClassifiedFailure[]): ClassifiedFailure[] {
      return [...failures].sort((a, b) =>
        PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)
      );
    },
  };
}