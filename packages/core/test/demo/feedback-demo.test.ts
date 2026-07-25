import { describe, it, expect } from 'vitest';
import { createTestRunner } from '../../src/feedback/test-runner.js';
import { createResultParser } from '../../src/feedback/result-parser.js';
import { createFailureClassifier } from '../../src/feedback/failure-classifier.js';
import { createFixSuggestionBuilder } from '../../src/feedback/fix-suggestion.js';
import { createFeedbackLoop } from '../../src/feedback/feedback-loop.js';

describe('Feedback Demo (机制演示 ②)', () => {
  it('should detect test failure and feed back to LLM', async () => {
    // This test demonstrates the feedback loop in isolation (no AgentLoop needed)
    const resultParser = createResultParser();
    const failureClassifier = createFailureClassifier();
    const fixSuggestionBuilder = createFixSuggestionBuilder();

    // Simulate: TestRunner returns failing Jest output
    const mockTestRunner = {
      run: async () => ({
        exitCode: 1,
        stdout: `● add function › should correctly add
    Expected: 5
    Received: 4
      at Object.<anonymous> (src/add.test.ts:5:18)`,
        stderr: '',
        durationMs: 100,
      }),
    };

    const feedbackLoop = createFeedbackLoop(
      mockTestRunner,
      resultParser,
      failureClassifier,
      fixSuggestionBuilder,
    );

    const result = await feedbackLoop.run('/tmp/test', null);

    // Verify feedback was structured correctly
    expect(result.status).toBe('fail');
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures[0].file).toContain('add.test.ts');
    expect(result.failures[0].type).toBe('assertion');
    expect(result.actionableFix).not.toBeNull();
    expect(result.actionableFix!.suggestedActions.length).toBeGreaterThan(0);
  });
});