import type {
  AgentLoopResult,
  AgentResponse,
  FeedbackRun,
  FeedbackState,
  Message,
  Session,
  ToolCallRecord,
  ToolCallRequest,
} from '../types.js';
import type { LLMAdapter } from '../llm/adapter.js';
import { ToolApprovalRequiredError, type ToolRegistry } from '../tools/tool.js';
import type { GovernanceService } from '../guardrail/index.js';
import type { FeedbackLoop } from '../feedback/feedback-loop.js';
import type { ContextBuilder } from './context-builder.js';
import type { StopCondition } from './stop-condition.js';
import { parseResponse } from '../llm/response-parser.js';

export interface AgentLoopDependencies {
  llm: LLMAdapter;
  tools: ToolRegistry;
  governance: GovernanceService;
  feedback: FeedbackLoop;
  contextBuilder: ContextBuilder;
  stopCondition: StopCondition;
  config: { maxIterations: number };
  onEvent?: (type: string, data: any) => void;
}

export interface AgentLoop {
  run(task: string, workingDir: string): Promise<AgentLoopResult>;
  continueAfterApproval(approved: boolean): Promise<AgentLoopResult>;
  handleApproval(approved: boolean): void;
  abort(): void;
}

interface PendingIteration {
  readonly response: AgentResponse;
  readonly parsed: ReturnType<typeof parseResponse>;
  readonly toolIndex: number;
}

interface ExecutionState {
  readonly task: string;
  readonly workingDir: string;
  readonly messages: Message[];
  readonly toolCalls: ToolCallRecord[];
  readonly feedbackRuns: FeedbackRun[];
  feedbackState: FeedbackState | null;
  iteration: number;
  testPassed: boolean;
  pending: PendingIteration | null;
}

const isTestCommand = (command: string): boolean => {
  const lower = command.toLowerCase();
  return /\b(test|assert|spec)\b/.test(lower)
    || /node\s+.*\.test\.(js|ts|mjs)/.test(lower)
    || /node\s+.*\.spec\.(js|ts|mjs)/.test(lower)
    || /^(npx|npm)\s+(test|vitest|jest|run test)/.test(lower);
};

export function createAgentLoop(deps: AgentLoopDependencies): AgentLoop {
  deps.tools.setGovernance(deps.governance);
  let aborted = false;
  const abortController = new AbortController();
  let currentState: ExecutionState | null = null;

  const buildSession = (
    state: ExecutionState,
    status: AgentLoopResult['status'],
  ): Session => ({
    id: generateId(),
    createdAt: new Date(),
    task: state.task,
    messages: state.messages,
    toolCalls: state.toolCalls,
    feedbackRuns: state.feedbackRuns,
    status: status === 'max_iterations' ? 'completed' : status as Session['status'],
    conclusion: null,
  });

  const finish = (
    state: ExecutionState,
    status: AgentLoopResult['status'],
  ): AgentLoopResult => {
    const result = { status, session: buildSession(state, status) };
    if (status !== 'blocked') {
      currentState = null;
    }
    return result;
  };

  const executeToolCall = async (
    state: ExecutionState,
    toolCall: ToolCallRequest,
  ): Promise<void> => {
    const startTime = Date.now();
    let result;
    try {
      deps.onEvent?.('tool_call', {
        name: toolCall.name,
        arguments: toolCall.arguments,
        status: 'running',
      });
      result = await deps.tools.execute(toolCall.name, toolCall.arguments, {
        toolCallId: toolCall.id,
      });
    } catch (error: any) {
      if (error instanceof ToolApprovalRequiredError) {
        throw error;
      }
      result = { success: false, output: '', error: error.message };
    }
    if (aborted) {
      return;
    }
    const approvedByUser = deps.governance.isApprovedAction(toolCall);
    deps.governance.completeApprovedAction(toolCall);
    deps.onEvent?.('tool_call', {
      name: toolCall.name,
      arguments: toolCall.arguments,
      result,
      status: 'done',
    });
    state.toolCalls.push({
      timestamp: new Date(),
      toolName: toolCall.name,
      params: toolCall.arguments,
      result,
      guardrailCheck: approvedByUser ? 'approved_by_user' : 'passed',
    });
    state.messages.push({
      role: 'tool',
      content: JSON.stringify(result),
      toolCallId: toolCall.id,
      name: toolCall.name,
    });

    const isTestRun = toolCall.name === 'run_tests'
      || (toolCall.name === 'execute_shell'
        && isTestCommand(String(toolCall.arguments?.command || '')));
    if (!isTestRun) {
      return;
    }
    const feedbackResult = toolCall.name === 'run_tests'
      ? await deps.feedback.run(state.workingDir, state.feedbackState)
      : deps.feedback.parseOutput(
          result?.output || '',
          result?.error || '',
          result?.success !== false ? 0 : 1,
        );
    state.feedbackRuns.push({
      iteration: state.iteration,
      testResult: feedbackResult.status === 'pass' ? 'pass' : 'fail',
      failureCount: feedbackResult.failures.length,
      fixApplied: false,
      timeSpent: Date.now() - startTime,
    });
    deps.onEvent?.('feedback', {
      status: feedbackResult.status,
      failures: feedbackResult.failures,
      iteration: state.iteration,
    });
    state.testPassed = feedbackResult.status === 'pass';
    state.feedbackState = {
      lastResult: feedbackResult,
      iteration: state.iteration,
    };
    if (!deps.feedback.shouldContinue(
      feedbackResult,
      state.feedbackState,
      deps.config.maxIterations,
    ) && feedbackResult.status === 'fail') {
      state.testPassed = false;
    }
  };

  const drive = async (
    state: ExecutionState,
  ): Promise<AgentLoopResult> => {
    while (!aborted) {
      let response: AgentResponse;
      let parsed: ReturnType<typeof parseResponse>;
      let firstToolIndex = 0;

      if (state.pending) {
        ({ response, parsed, toolIndex: firstToolIndex } = state.pending);
        state.pending = null;
      } else {
        const context = deps.contextBuilder.build({
          task: state.task,
          messages: state.messages,
          tools: deps.tools.list(),
          memories: [],
          config: deps.config as any,
          feedbackState: state.feedbackState,
        });
        deps.onEvent?.('loop_step', { iteration: state.iteration, phase: 'calling_llm' });
        response = await deps.llm.sendMessage(context, abortController.signal);
        if (aborted) {
          return finish(state, 'failed');
        }
        parsed = parseResponse(response);
        deps.onEvent?.('loop_step', {
          iteration: state.iteration,
          content: response.content?.slice(0, 300),
        });
        state.messages.push({
          role: 'assistant',
          content: response.content,
          ...(response.toolCalls.length > 0 ? { toolCalls: response.toolCalls } : {}),
        });
      }

      for (let index = firstToolIndex; index < response.toolCalls.length; index += 1) {
        if (aborted) {
          return finish(state, 'failed');
        }
        const toolCall = response.toolCalls[index]!;
        try {
          await executeToolCall(state, toolCall);
        } catch (error) {
          if (!(error instanceof ToolApprovalRequiredError)) {
            throw error;
          }
          state.pending = { response, parsed, toolIndex: index };
          deps.onEvent?.('guardrail', { toolCall, decision: 'blocked' });
          return finish(state, 'blocked');
        }
        if (aborted) {
          return finish(state, 'failed');
        }
      }

      state.iteration += 1;
      const stopResult = deps.stopCondition.check({
        isComplete: parsed.isComplete,
        testPassed: state.testPassed,
        currentIteration: state.iteration,
        maxIterations: deps.config.maxIterations,
        hitlState: deps.governance.hitl.state,
      });
      if (stopResult.shouldStop) {
        const statusMap: Record<string, AgentLoopResult['status']> = {
          task_complete: 'completed',
          max_iterations: 'max_iterations',
          blocked_waiting: 'blocked',
        };
        return finish(state, statusMap[stopResult.reason!] || 'failed');
      }
    }
    return finish(state, 'failed');
  };

  return {
    async run(task, workingDir) {
      if (currentState) {
        throw new Error('Agent loop already has an active or blocked run');
      }
      currentState = {
        task,
        workingDir,
        messages: [],
        toolCalls: [],
        feedbackRuns: [],
        feedbackState: null,
        iteration: 0,
        testPassed: true,
        pending: null,
      };
      return drive(currentState);
    },

    async continueAfterApproval(approved) {
      const state = currentState;
      if (!state?.pending) {
        throw new Error('Agent loop has no blocked action to continue');
      }
      if (!approved) {
        deps.governance.hitl.reject();
        deps.governance.hitl.reset();
        state.pending = null;
        return finish(state, 'failed');
      }
      deps.governance.hitl.approve();
      return drive(state);
    },

    handleApproval(approved) {
      if (approved) deps.governance.hitl.approve();
      else deps.governance.hitl.reject();
      deps.governance.hitl.reset();
    },

    abort() {
      aborted = true;
      abortController.abort();
    },
  };
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2);
}
