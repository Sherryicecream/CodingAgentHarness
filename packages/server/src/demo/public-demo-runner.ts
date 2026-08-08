import {
  createFeedbackLoop,
  type FeedbackLoop,
} from '../../../core/src/feedback/feedback-loop.js';
import { createFailureClassifier } from '../../../core/src/feedback/failure-classifier.js';
import { createFixSuggestionBuilder } from '../../../core/src/feedback/fix-suggestion.js';
import { createResultParser } from '../../../core/src/feedback/result-parser.js';
import type { TestRunner } from '../../../core/src/feedback/test-runner.js';
import { createGovernanceService } from '../../../core/src/guardrail/index.js';
import { createWriteFileTool } from '../../../core/src/tools/write-file.js';
import type { ToolCallRequest } from '../../../core/src/types.js';
import type { PublicSession } from '../session/session-registry.js';
import type { WorkspaceManager } from '../session/workspace-manager.js';
import type { SSEEvent } from '../sse/sse-manager.js';

export interface DemoResult {
  readonly status: 'completed';
  readonly sessionId: string;
}

export interface PublicDemoRunner {
  run(session: PublicSession, signal?: AbortSignal): Promise<DemoResult>;
}

export interface PublicDemoRunnerOptions {
  readonly emit: (type: SSEEvent['type'], data: unknown) => void;
  readonly workspaceManager: WorkspaceManager;
  readonly now?: () => Date;
  readonly emitComplete?: boolean;
}

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
  if (signal?.aborted) {
    throw new Error('DEMO_ABORTED');
  }
};

export const createPublicDemoRunner = (
  options: PublicDemoRunnerOptions,
): PublicDemoRunner => {
  const now = options.now ?? (() => new Date());

  return {
    async run(session, signal) {
      // The issued manager is deliberately part of this runner's capability set;
      // the only filesystem tool is additionally rooted to this session workspace.
      void options.workspaceManager;
      throwIfAborted(signal);
      const governance = createGovernanceService();
      const feedback = createInjectedFeedback();
      const writeFile = createWriteFileTool(session.workspace);
      const initialWrite = await writeFile.execute({
        path: 'demo.ts',
        content: "export const greeting = 'hello';\n",
      });
      throwIfAborted(signal);
      if (!initialWrite.success) {
        throw new Error('DEMO_INITIAL_WRITE_FAILED');
      }
      options.emit('tool_call', {
        sessionId: session.id,
        stage: 'initial_write',
        tool: 'write_file',
        status: 'done',
        result: initialWrite,
        at: now().toISOString(),
      });

      const dangerousAction: ToolCallRequest = {
        id: `demo-dangerous-write-${session.id}`,
        name: 'write_file',
        arguments: { path: '.git/config', content: 'unsafe' },
      };
      const allowed = governance.preCheck(dangerousAction);
      if (allowed) {
        throw new Error('DEMO_GOVERNANCE_FAILED');
      }
      options.emit('guardrail', {
        sessionId: session.id,
        stage: 'dangerous_action_blocked',
        decision: 'blocked',
        executed: false,
        toolCall: dangerousAction,
        at: now().toISOString(),
      });

      const failedValidation = await feedback.run(session.workspace, null);
      throwIfAborted(signal);
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

      throwIfAborted(signal);
      const correctedWrite = await writeFile.execute({
        path: 'demo.ts',
        content: "export const greeting = 'hello, harness';\n",
      });
      throwIfAborted(signal);
      if (!correctedWrite.success) {
        throw new Error('DEMO_CORRECTED_WRITE_FAILED');
      }
      options.emit('tool_call', {
        sessionId: session.id,
        stage: 'corrected_write',
        tool: 'write_file',
        status: 'done',
        result: correctedWrite,
        at: now().toISOString(),
      });

      const passedValidation = await feedback.run(session.workspace, {
        lastResult: failedValidation,
        iteration: 1,
      });
      throwIfAborted(signal);
      options.emit('feedback', {
        sessionId: session.id,
        stage: 'validation_passed',
        ...passedValidation,
        at: now().toISOString(),
      });
      const result: DemoResult = { status: 'completed', sessionId: session.id };
      if (options.emitComplete !== false) {
        options.emit('complete', {
          stage: 'demo_complete',
          ...result,
          at: now().toISOString(),
        });
      }
      return result;
    },
  };
};
