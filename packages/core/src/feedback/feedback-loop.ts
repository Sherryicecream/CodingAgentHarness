import { FeedbackResult, FeedbackState } from '../types.js';
import { TestRunner } from './test-runner.js';
import { ResultParser } from './result-parser.js';
import { FailureClassifier } from './failure-classifier.js';
import { FixSuggestionBuilder } from './fix-suggestion.js';

export interface FeedbackLoop {
  run(workingDir: string, state: FeedbackState | null): Promise<FeedbackResult>;
  /** Parse raw test output (for execute_shell test commands) */
  parseOutput(stdout: string, stderr: string, exitCode: number): FeedbackResult;
  shouldContinue(result: FeedbackResult, state: FeedbackState | null, maxIterations: number): boolean;
}

export function createFeedbackLoop(
  testRunner: TestRunner,
  resultParser: ResultParser,
  failureClassifier: FailureClassifier,
  fixSuggestionBuilder: FixSuggestionBuilder,
): FeedbackLoop {
  return {
    async run(workingDir: string, state: FeedbackState | null): Promise<FeedbackResult> {
      // Run tests
      const testResult = await testRunner.run(workingDir);

      // Parse results
      const failures = resultParser.parse(testResult.stdout, testResult.stderr, testResult.exitCode);

      // Classify failures
      const classified = failureClassifier.classify(failures);

      // Build fix suggestion
      const actionableFix = classified.length > 0
        ? fixSuggestionBuilder.build(classified)
        : null;

      const passed = resultParser.isPassed(testResult.exitCode);

      return {
        status: passed ? 'pass' : 'fail',
        failures,
        actionableFix,
      };
    },

    parseOutput(stdout: string, stderr: string, exitCode: number): FeedbackResult {
      const failures = resultParser.parse(stdout, stderr, exitCode);
      const classified = failureClassifier.classify(failures);
      const actionableFix = classified.length > 0
        ? fixSuggestionBuilder.build(classified)
        : null;
      return {
        status: resultParser.isPassed(exitCode) ? 'pass' : 'fail',
        failures,
        actionableFix,
      };
    },

    shouldContinue(result: FeedbackResult, state: FeedbackState | null, maxIterations: number): boolean {
      const currentIteration = state?.iteration ?? 0;
      if (result.status === 'pass') return false;
      if (currentIteration >= maxIterations) return false;
      return true;
    },
  };
}