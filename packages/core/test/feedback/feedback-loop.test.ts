import { describe, it, expect, vi } from 'vitest';
import { createFeedbackLoop, FeedbackLoop } from '../../src/feedback/feedback-loop.js';
import { TestRunner, TestRunResult } from '../../src/feedback/test-runner.js';
import { createResultParser } from '../../src/feedback/result-parser.js';
import { createFailureClassifier } from '../../src/feedback/failure-classifier.js';
import { createFixSuggestionBuilder } from '../../src/feedback/fix-suggestion.js';
import { FeedbackResult, FeedbackState } from '../../src/types.js';

function makeMockTestRunner(result: TestRunResult): TestRunner {
  return {
    run: vi.fn().mockResolvedValue(result),
  };
}

const passingResult: TestRunResult = {
  exitCode: 0,
  stdout: 'Tests: 3 passed, 3 total',
  stderr: '',
  durationMs: 100,
};

const failingResult: TestRunResult = {
  exitCode: 1,
  stdout: `● addition test
    Expected: 2
    Received: 3
    at Object.<anonymous> (src/math.test.ts:10:15)

● subtraction test
    Expected: 0
    Received: -1
    at Object.<anonymous> (src/math.test.ts:20:15)`,
  stderr: '',
  durationMs: 200,
};

function createLoop(testRunner: TestRunner): FeedbackLoop {
  return createFeedbackLoop(
    testRunner,
    createResultParser(),
    createFailureClassifier(),
    createFixSuggestionBuilder(),
  );
}

describe('FeedbackLoop', () => {
  describe('run', () => {
    it('passing tests → returns status "pass" with no actionableFix', async () => {
      const mockRunner = makeMockTestRunner(passingResult);
      const loop = createLoop(mockRunner);

      const result = await loop.run('/tmp/workspace', null);

      expect(result.status).toBe('pass');
      expect(result.failures).toEqual([]);
      expect(result.actionableFix).toBeNull();
      expect(mockRunner.run).toHaveBeenCalledWith('/tmp/workspace');
    });

    it('failing tests → returns status "fail" with actionableFix', async () => {
      const mockRunner = makeMockTestRunner(failingResult);
      const loop = createLoop(mockRunner);

      const result = await loop.run('/tmp/workspace', null);

      expect(result.status).toBe('fail');
      expect(result.failures.length).toBeGreaterThan(0);
      expect(result.actionableFix).not.toBeNull();
      expect(result.actionableFix!.failures.length).toBeGreaterThan(0);
      expect(result.actionableFix!.summary).toContain('test failure(s) detected');
      expect(mockRunner.run).toHaveBeenCalledWith('/tmp/workspace');
    });

    it('failing tests with no parseable failures → status "fail" with null actionableFix', async () => {
      const mockRunner = makeMockTestRunner({
        exitCode: 1,
        stdout: 'Something went wrong',
        stderr: 'Error: compilation failed',
        durationMs: 50,
      });
      const loop = createLoop(mockRunner);

      const result = await loop.run('/tmp/workspace', null);

      expect(result.status).toBe('fail');
      expect(result.failures).toEqual([]);
      expect(result.actionableFix).toBeNull();
    });

    it('correctly chains all 4 components (integration)', async () => {
      const mockRunner = makeMockTestRunner(failingResult);
      const loop = createLoop(mockRunner);

      const result = await loop.run('/tmp/workspace', null);

      // TestRunner was called
      expect(mockRunner.run).toHaveBeenCalledTimes(1);

      // ResultParser produced failures with correct fields
      expect(result.failures.length).toBe(2);
      expect(result.failures[0]).toMatchObject({
        file: 'src/math.test.ts',
        line: 10,
        type: 'assertion',
      });
      expect(result.failures[1]).toMatchObject({
        file: 'src/math.test.ts',
        line: 20,
        type: 'assertion',
      });

      // FailureClassifier assigned priorities
      // FixSuggestionBuilder built a suggestion with sorted actions
      expect(result.actionableFix).not.toBeNull();
      expect(result.actionableFix!.suggestedActions.length).toBe(2);
      // suggestedActions should contain priority tags
      expect(result.actionableFix!.suggestedActions[0]).toContain('[medium]');
    });

    it('uses the state parameter (state is passed through)', async () => {
      const mockRunner = makeMockTestRunner(passingResult);
      const loop = createLoop(mockRunner);

      const state: FeedbackState = {
        iteration: 3,
        lastResult: { status: 'fail', failures: [], actionableFix: null },
      };

      const result = await loop.run('/tmp/workspace', state);

      // run() does not mutate state — it just accepts it
      expect(result.status).toBe('pass');
      expect(state.iteration).toBe(3); // unchanged
    });
  });

  describe('shouldContinue', () => {
    it('passing tests → shouldContinue returns false', () => {
      const mockRunner = makeMockTestRunner(passingResult);
      const loop = createLoop(mockRunner);

      const passResult: FeedbackResult = {
        status: 'pass',
        failures: [],
        actionableFix: null,
      };

      expect(loop.shouldContinue(passResult, null, 10)).toBe(false);
      expect(loop.shouldContinue(passResult, { iteration: 0, lastResult: passResult }, 10)).toBe(false);
    });

    it('failing tests below maxIterations → shouldContinue returns true', () => {
      const mockRunner = makeMockTestRunner(failingResult);
      const loop = createLoop(mockRunner);

      const failResult: FeedbackResult = {
        status: 'fail',
        failures: [],
        actionableFix: null,
      };

      const state: FeedbackState = {
        iteration: 2,
        lastResult: failResult,
      };

      expect(loop.shouldContinue(failResult, state, 5)).toBe(true);
    });

    it('max iterations reached → shouldContinue returns false even if tests fail', () => {
      const mockRunner = makeMockTestRunner(failingResult);
      const loop = createLoop(mockRunner);

      const failResult: FeedbackResult = {
        status: 'fail',
        failures: [],
        actionableFix: null,
      };

      const state: FeedbackState = {
        iteration: 5,
        lastResult: failResult,
      };

      expect(loop.shouldContinue(failResult, state, 5)).toBe(false);
    });

    it('iteration exceeds maxIterations → shouldContinue returns false', () => {
      const mockRunner = makeMockTestRunner(failingResult);
      const loop = createLoop(mockRunner);

      const failResult: FeedbackResult = {
        status: 'fail',
        failures: [],
        actionableFix: null,
      };

      const state: FeedbackState = {
        iteration: 6,
        lastResult: failResult,
      };

      expect(loop.shouldContinue(failResult, state, 5)).toBe(false);
    });

    it('null state (iteration 0) → shouldContinue true for fail, maxIterations > 0', () => {
      const mockRunner = makeMockTestRunner(failingResult);
      const loop = createLoop(mockRunner);

      const failResult: FeedbackResult = {
        status: 'fail',
        failures: [],
        actionableFix: null,
      };

      // null state means iteration defaults to 0
      expect(loop.shouldContinue(failResult, null, 3)).toBe(true);
    });

    it('null state with maxIterations 0 → shouldContinue returns false', () => {
      const mockRunner = makeMockTestRunner(failingResult);
      const loop = createLoop(mockRunner);

      const failResult: FeedbackResult = {
        status: 'fail',
        failures: [],
        actionableFix: null,
      };

      // null state means iteration 0, maxIterations is 0, so 0 >= 0 → false
      expect(loop.shouldContinue(failResult, null, 0)).toBe(false);
    });
  });
});