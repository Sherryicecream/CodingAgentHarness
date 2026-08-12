import { describe, it, expect } from 'vitest';
import { createTestRunner } from '../../src/feedback/test-runner.js';
import { createResultParser } from '../../src/feedback/result-parser.js';
import { createFailureClassifier } from '../../src/feedback/failure-classifier.js';
import { createFixSuggestionBuilder } from '../../src/feedback/fix-suggestion.js';
import { createFeedbackLoop } from '../../src/feedback/feedback-loop.js';
import {
  MockLLMAdapter,
  MockLLMExhaustedError,
  type MockLLMSelectorContext,
} from '../../src/llm/mock.js';
import { createAgentLoop } from '../../src/loop/agent-loop.js';
import { createContextBuilder } from '../../src/loop/context-builder.js';
import { createStopCondition } from '../../src/loop/stop-condition.js';
import { createToolRegistry } from '../../src/tools/tool.js';
import { createGovernanceService } from '../../src/guardrail/index.js';
import type {
  AgentResponse,
  MemoryStore,
  Message,
  Tool,
  ToolResult,
} from '../../src/types.js';

const createResponse = (
  content: string,
  toolCalls: AgentResponse['toolCalls'],
): AgentResponse => ({ content, toolCalls });

const emptyMemoryStore: MemoryStore = {
  add: async () => { throw new Error('not used by feedback demo'); },
  search: async () => [],
  list: async () => [],
  delete: async () => undefined,
  getByType: async () => [],
};

const runTestsTool: Tool = {
  definition: { name: 'run_tests', description: 'Run the demo test', parameters: {} },
  riskLevel: 'safe',
  execute: async (): Promise<ToolResult> => ({ success: true, output: 'demo test executed' }),
};

const structuredFeedbackMarker = 'Structured feedback:\n';
const structuredFeedbackSuffix = '\nUse the actionable fix to choose the next action.';
const expectedSuggestedAction = '[medium] demo.ts:1 — greeting validation (assertion)';

interface StructuredFeedback {
  status: 'fail' | 'pass' | 'error';
  failures: Array<{ file: string; line: number; type: string }>;
  actionableFix: {
    summary: string;
    suggestedActions: string[];
  } | null;
}

const parseStructuredFeedback = (messages: Message[]): StructuredFeedback | null => {
  const feedbackMessage = messages.find((message) => (
    message.role === 'system' && message.content.includes(structuredFeedbackMarker)
  ));
  if (!feedbackMessage) return null;
  const start = feedbackMessage.content.indexOf(structuredFeedbackMarker) + structuredFeedbackMarker.length;
  const end = feedbackMessage.content.indexOf(structuredFeedbackSuffix, start);
  if (end === -1) return null;
  try {
    return JSON.parse(feedbackMessage.content.slice(start, end)) as StructuredFeedback;
  } catch {
    return null;
  }
};

const selectsGreetingCorrection = (feedback: StructuredFeedback | null): boolean => (
  feedback?.status === 'fail'
  && feedback.failures.some((failure) => (
    failure.file === 'demo.ts' && failure.line === 1 && failure.type === 'assertion'
  ))
  && feedback.actionableFix?.summary === '1 test failure(s) detected.'
  && feedback.actionableFix.suggestedActions.includes(expectedSuggestedAction)
);

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

  it('changes the next action only after structured actionable feedback is in the LLM request', async () => {
    const resultParser = createResultParser();
    const failureClassifier = createFailureClassifier();
    const fixSuggestionBuilder = createFixSuggestionBuilder();
    const testOutputs = [
      {
        exitCode: 1,
        stdout: ` FAIL  demo.ts > greeting validation
- Expected: hello, harness
+ Received: hello
    at Object.<anonymous> (demo.ts:1:1)`,
        stderr: '',
      },
      { exitCode: 0, stdout: ' PASS  demo.ts', stderr: '' },
    ];
    let testRun = 0;
    const feedback = createFeedbackLoop(
      { run: async () => ({ ...testOutputs[testRun++]!, durationMs: 1 }) },
      resultParser,
      failureClassifier,
      fixSuggestionBuilder,
    );
    const actions: string[] = [];
    const writeFile: Tool = {
      definition: { name: 'write_file', description: 'Record the correction', parameters: {} },
      riskLevel: 'safe',
      execute: async (params) => {
        actions.push(String(params.content));
        return { success: true, output: 'recorded correction' };
      },
    };
    const selectResponse = ({ messages }: MockLLMSelectorContext): AgentResponse | undefined => {
      const hasPriorTestAction = messages.some((message) => (
        message.role === 'assistant' && message.content === 'Run the known failing greeting test.'
      ));
      if (!hasPriorTestAction) {
        return createResponse('Run the known failing greeting test.', [{
          id: 'first-test', name: 'run_tests', arguments: {},
        }]);
      }
      if (selectsGreetingCorrection(parseStructuredFeedback(messages))) {
        return createResponse('Apply the observed greeting correction. TASK_COMPLETE', [
          { id: 'correct-greeting', name: 'write_file', arguments: { content: 'hello, harness' } },
          { id: 'second-test', name: 'run_tests', arguments: {} },
        ]);
      }
      return undefined;
    };
    const llm = new MockLLMAdapter(selectResponse);
    const tools = createToolRegistry();
    tools.register(runTestsTool);
    tools.register(writeFile);
    const loop = createAgentLoop({
      llm,
      tools,
      governance: createGovernanceService(),
      feedback,
      contextBuilder: createContextBuilder(),
      stopCondition: createStopCondition(),
      memoryStore: emptyMemoryStore,
      config: { maxIterations: 3 },
    });

    const result = await loop.run('Correct the demo greeting', '/tmp/feedback-causality-demo');

    expect(result.status).toBe('completed');
    expect(result.session.feedbackRuns).toMatchObject([
      { testResult: 'fail', failureCount: 1 },
      { testResult: 'pass', failureCount: 0 },
    ]);
    expect(result.session.toolCalls.map((call) => call.toolName)).toEqual([
      'run_tests', 'write_file', 'run_tests',
    ]);
    expect(actions).toEqual(['hello, harness']);
    expect(llm.receivedContexts).toHaveLength(2);
    expect(llm.receivedContexts[0]!.feedbackState).toBeNull();
    expect(llm.receivedContexts[1]!.feedbackState).toMatchObject({
      lastResult: {
        status: 'fail',
        failures: [{ file: 'demo.ts', type: 'assertion' }],
        actionableFix: { suggestedActions: [expectedSuggestedAction] },
      },
    });
    const secondContext = llm.receivedContexts[1]!;
    expect(parseStructuredFeedback(secondContext.messages)).toMatchObject({
      failures: [{ file: 'demo.ts', line: 1, type: 'assertion' }],
      actionableFix: {
        summary: '1 test failure(s) detected.',
        suggestedActions: [expectedSuggestedAction],
      },
    });

    for (const messages of [
      secondContext.messages.filter((message) => !message.content.includes(structuredFeedbackMarker)),
      secondContext.messages.map((message) => ({
        ...message,
        content: message.content.replace(expectedSuggestedAction, 'unrelated fix'),
      })),
    ]) {
      const adapter = new MockLLMAdapter(selectResponse);
      await expect(adapter.sendMessage({ ...secondContext, messages })).rejects.toThrow(MockLLMExhaustedError);
      expect(adapter.receivedContexts).toHaveLength(1);
    }
  });
});
