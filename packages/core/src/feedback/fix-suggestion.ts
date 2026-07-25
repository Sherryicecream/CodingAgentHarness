import { ClassifiedFailure } from './failure-classifier.js';
import { FixSuggestion, TestFailure } from '../types.js';

export interface FixSuggestionBuilder {
  build(failures: ClassifiedFailure[]): FixSuggestion;
  toContextString(suggestion: FixSuggestion): string;
}

export function createFixSuggestionBuilder(): FixSuggestionBuilder {
  return {
    build(failures: ClassifiedFailure[]): FixSuggestion {
      const sorted = [...failures].sort((a, b) => {
        const order = ['high', 'medium', 'low'];
        return order.indexOf(a.priority) - order.indexOf(b.priority);
      });

      const summary = failures.length === 0
        ? 'All tests passed.'
        : `${failures.length} test failure(s) detected.`;

      const suggestedActions = sorted.map(f =>
        `[${f.priority}] ${f.failure.file}:${f.failure.line} — ${f.failure.message} (${f.category})`
      );

      return {
        summary,
        failures: sorted.map(f => f.failure),
        suggestedActions,
      };
    },

    toContextString(suggestion: FixSuggestion): string {
      if (suggestion.failures.length === 0) {
        return 'All tests passed. No fixes needed.';
      }

      const lines: string[] = [
        'The following tests failed. Please fix the code to make them pass:',
        '',
      ];

      for (const f of suggestion.failures) {
        lines.push(`File: ${f.file}:${f.line}`);
        lines.push(`Error: ${f.message}`);
        lines.push(`Type: ${f.type}`);
        lines.push(`Diff:\n${f.diff}`);
        lines.push('---');
      }

      lines.push('');
      lines.push('Fix the issues in priority order shown above.');
      return lines.join('\n');
    },
  };
}