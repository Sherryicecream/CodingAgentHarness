import { describe, it, expect } from 'vitest';
import { createResultParser } from '../../src/feedback/result-parser.js';
import { createFailureClassifier } from '../../src/feedback/failure-classifier.js';
import { createFixSuggestionBuilder } from '../../src/feedback/fix-suggestion.js';
import { createFeedbackLoop } from '../../src/feedback/feedback-loop.js';

describe('Deep Demo (机制演示 ③)', () => {
  // Scenario 1: Multi-round fix until pass
  it('should fix code across multiple iterations', async () => {
    const resultParser = createResultParser();
    const failureClassifier = createFailureClassifier();
    const fixSuggestionBuilder = createFixSuggestionBuilder();

    // Round 1: syntax error → fix → Round 2: assertion error → fix → Round 3: pass
    const responses = [
      { exitCode: 1, stdout: '● syntax test › SyntaxError: Unexpected token\n\n    at Object.<anonymous> (src/app.test.ts:3:10)', stderr: '' },
      { exitCode: 1, stdout: '● test › should match\n\n    Expected: 5\n    Received: 4\n\n      at Object.<anonymous> (src/app.test.ts:5:18)', stderr: '' },
      { exitCode: 0, stdout: 'Tests: 3 passed', stderr: '' },
    ];
    let callCount = 0;
    const mockTestRunner = {
      run: async () => ({ ...responses[callCount++], durationMs: 100 }),
    };

    const feedbackLoop = createFeedbackLoop(mockTestRunner, resultParser, failureClassifier, fixSuggestionBuilder);

    // Round 1
    const r1 = await feedbackLoop.run('/tmp', { lastResult: null as any, iteration: 0 });
    expect(r1.status).toBe('fail');
    expect(r1.failures[0].type).toBe('syntax');
    expect(feedbackLoop.shouldContinue(r1, { lastResult: r1, iteration: 0 }, 5)).toBe(true);

    // Round 2
    const r2 = await feedbackLoop.run('/tmp', { lastResult: r1, iteration: 1 });
    expect(r2.status).toBe('fail');
    expect(r2.failures[0].type).toBe('assertion');
    expect(feedbackLoop.shouldContinue(r2, { lastResult: r2, iteration: 1 }, 5)).toBe(true);

    // Round 3
    const r3 = await feedbackLoop.run('/tmp', { lastResult: r2, iteration: 2 });
    expect(r3.status).toBe('pass');
    expect(feedbackLoop.shouldContinue(r3, { lastResult: r3, iteration: 2 }, 5)).toBe(false);
  });

  // Scenario 2: Exceed max iterations
  it('should stop after max iterations', () => {
    const resultParser = createResultParser();
    const failureClassifier = createFailureClassifier();
    const fixSuggestionBuilder = createFixSuggestionBuilder();
    const mockTestRunner = { run: async () => ({ exitCode: 1, stdout: '', stderr: '', durationMs: 0 }) };
    const feedbackLoop = createFeedbackLoop(mockTestRunner, resultParser, failureClassifier, fixSuggestionBuilder);

    const result = { status: 'fail' as const, failures: [], actionableFix: null };
    const state = { lastResult: result, iteration: 5 };
    expect(feedbackLoop.shouldContinue(result, state, 5)).toBe(false); // maxIterations reached
  });
});