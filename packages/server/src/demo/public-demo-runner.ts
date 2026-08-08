import { createFailureClassifier } from '../../../core/src/feedback/failure-classifier.js';
import {
  createFeedbackLoop,
  type FeedbackLoop,
} from '../../../core/src/feedback/feedback-loop.js';
import { createFixSuggestionBuilder } from '../../../core/src/feedback/fix-suggestion.js';
import { createResultParser } from '../../../core/src/feedback/result-parser.js';
import type { TestRunner } from '../../../core/src/feedback/test-runner.js';
import { createGovernanceService } from '../../../core/src/guardrail/index.js';
import { createContextBuilder } from '../../../core/src/loop/context-builder.js';
import type {
  AgentConfig,
  FeedbackState,
  Message,
  ToolCallRequest,
  ToolResult,
} from '../../../core/src/types.js';
import type { PublicSession } from '../session/session-registry.js';
import type { WorkspaceManager } from '../session/workspace-manager.js';
import type { SSEEvent } from '../sse/sse-manager.js';
import { createPublicDemoToolRegistry } from './public-demo-dispatcher.js';
import {
  createPublicDemoAdapter,
  PUBLIC_DEMO_CALLS,
  type PublicDemoStage,
} from './public-demo-script.js';

export interface DemoResult {
  readonly status: 'completed';
  readonly sessionId: string;
}

export interface PublicDemoRunner {
  run(session: PublicSession, signal?: AbortSignal): Promise<DemoResult>;
}

export type DangerousDemoExecutor = (
  toolCall: ToolCallRequest,
) => Promise<ToolResult>;

export interface PublicDemoRunnerOptions {
  readonly emit: (type: SSEEvent['type'], data: unknown) => void;
  readonly workspaceManager: WorkspaceManager;
  readonly now?: () => Date;
  readonly emitComplete?: boolean;
  readonly dangerousExecutor?: DangerousDemoExecutor;
}

const DEMO_CONFIG: AgentConfig = Object.freeze({
  maxIterations: 3,
  testCommand: 'in-process-demo-validation',
  allowedTools: ['write_file'],
  blockedCommands: [],
  ignoredPaths: [],
});

const createInjectedFeedback = (): FeedbackLoop => {
  const failedValidation = {
    exitCode: 1,
    stdout: [
      ' FAIL  demo.ts > greeting validation',
      '- Expected: hello, harness',
      '+ Received: hello',
    ].join('\n'),
    stderr: '',
    durationMs: 0,
  };
  const passedValidation = {
    exitCode: 0,
    stdout: ' PASS  demo.ts',
    stderr: '',
    durationMs: 0,
  };
  let validationCount = 0;
  const testRunner: TestRunner = {
    run: async () => (validationCount++ === 0 ? failedValidation : passedValidation),
  };
  return createFeedbackLoop(
    testRunner,
    createResultParser(),
    createFailureClassifier(),
    createFixSuggestionBuilder(),
  );
};

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new Error('DEMO_ABORTED');
};

const emitToolResult = (
  options: PublicDemoRunnerOptions,
  sessionId: string,
  stage: PublicDemoStage,
  toolCall: ToolCallRequest,
  result: ToolResult,
  context: { messageCount: number; toolNames: string[] },
  dispatch: 'registry' | 'governance',
): void => {
  options.emit('tool_call', {
    sessionId,
    stage,
    name: toolCall.name,
    arguments: toolCall.arguments,
    riskLevel: dispatch === 'governance' ? 'dangerous' : 'moderate',
    status: result.success ? 'done' : 'failed',
    result,
    context,
    dispatch,
    at: (options.now ?? (() => new Date()))().toISOString(),
  });
};

export const createPublicDemoRunner = (
  options: PublicDemoRunnerOptions,
): PublicDemoRunner => ({
  async run(session, signal) {
    throwIfAborted(signal);
    const issuedPath = options.workspaceManager.getIssuedPath(session.id);
    if (!issuedPath || issuedPath !== session.workspace) {
      throw new Error('DEMO_WORKSPACE_MISMATCH');
    }
    options.workspaceManager.assertIssued(session.id, session.workspace);
    const now = options.now ?? (() => new Date());
    const adapter = createPublicDemoAdapter();
    const contextBuilder = createContextBuilder(
      'Run only the deterministic in-process public demonstration using write_file.',
    );
    const tools = createPublicDemoToolRegistry(options.workspaceManager, session.id);
    const governance = createGovernanceService();
    const feedback = createInjectedFeedback();
    const messages: Message[] = [];
    let feedbackState: FeedbackState | null = null;

    for (const scriptedCall of PUBLIC_DEMO_CALLS) {
      throwIfAborted(signal);
      const context = contextBuilder.build({
        task: 'Demonstrate safe governed file correction.',
        messages,
        tools: tools.list(),
        memories: [],
        config: DEMO_CONFIG,
        feedbackState,
      });
      const response = await adapter.sendMessage(context);
      throwIfAborted(signal);
      const toolCall = response.toolCalls[0];
      if (response.toolCalls.length !== 1 || toolCall?.id !== scriptedCall.callId) {
        throw new Error('DEMO_SCRIPT_INVALID');
      }
      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });
      const contextSummary = {
        messageCount: context.messages.filter((message) => message.role !== 'system').length,
        toolNames: context.tools.map((tool) => tool.name),
      };
      const allowed = governance.preCheck(toolCall);
      let result: ToolResult;
      if (!allowed) {
        governance.hitl.reject();
        governance.hitl.reset();
        result = { success: false, output: '', error: 'BLOCKED_BY_GOVERNANCE' };
      } else if (scriptedCall.stage === 'dangerous_action_blocked') {
        await options.dangerousExecutor?.(toolCall);
        throw new Error('DEMO_GOVERNANCE_FAILED');
      } else {
        result = await tools.execute(toolCall.name, toolCall.arguments);
      }
      throwIfAborted(signal);
      emitToolResult(
        options,
        session.id,
        scriptedCall.stage,
        toolCall,
        result,
        contextSummary,
        allowed ? 'registry' : 'governance',
      );
      messages.push({
        role: 'tool',
        name: toolCall.name,
        toolCallId: toolCall.id,
        content: JSON.stringify(result),
      });
      if (scriptedCall.stage === 'initial_write') {
        if (!result.success) throw new Error('DEMO_INITIAL_WRITE_FAILED');
      }
      if (scriptedCall.stage === 'dangerous_action_blocked') {
        const failedValidation = await feedback.run(issuedPath, null);
        throwIfAborted(signal);
        feedbackState = { lastResult: failedValidation, iteration: 1 };
        options.emit('loop_step', {
          sessionId: session.id,
          stage: 'validation_failed',
          status: failedValidation.status,
          at: now().toISOString(),
        });
        options.emit('feedback', {
          sessionId: session.id,
          stage: 'structured_feedback',
          ...failedValidation,
          at: now().toISOString(),
        });
      }
      if (scriptedCall.stage === 'corrected_write') {
        if (!result.success) throw new Error('DEMO_CORRECTED_WRITE_FAILED');
        const passedValidation = await feedback.run(issuedPath, feedbackState);
        throwIfAborted(signal);
        options.emit('feedback', {
          sessionId: session.id,
          stage: 'validation_passed',
          ...passedValidation,
          at: now().toISOString(),
        });
      }
    }
    const result: DemoResult = { status: 'completed', sessionId: session.id };
    if (options.emitComplete !== false) {
      options.emit('complete', { stage: 'demo_complete', ...result, at: now().toISOString() });
    }
    return result;
  },
});
