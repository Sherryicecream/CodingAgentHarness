import { AgentContext, AgentLoopResult, AgentResponse, Message, Session, ToolCallRecord, FeedbackRun } from '../types.js';
import { LLMAdapter } from '../llm/adapter.js';
import { ToolRegistry } from '../tools/tool.js';
import { GovernanceService } from '../guardrail/index.js';
import { FeedbackLoop } from '../feedback/feedback-loop.js';
import { ContextBuilder } from './context-builder.js';
import { StopCondition } from './stop-condition.js';
import { parseResponse } from '../llm/response-parser.js';

export interface AgentLoopDependencies {
  llm: LLMAdapter;
  tools: ToolRegistry;
  governance: GovernanceService;
  feedback: FeedbackLoop;
  contextBuilder: ContextBuilder;
  stopCondition: StopCondition;
  config: { maxIterations: number };
}

export interface AgentLoop {
  run(task: string, workingDir: string): Promise<AgentLoopResult>;
  handleApproval(approved: boolean): void;
  abort(): void;
}

export function createAgentLoop(deps: AgentLoopDependencies): AgentLoop {
  let aborted = false;

  return {
    async run(task: string, workingDir: string): Promise<AgentLoopResult> {
      const messages: Message[] = [];
      const toolCalls: ToolCallRecord[] = [];
      const feedbackRuns: FeedbackRun[] = [];
      let feedbackState = null;
      let iteration = 0;
      let testPassed = true; // Default to true: no tests have failed yet

      while (!aborted) {
        // 1. Build context
        const context = deps.contextBuilder.build({
          task, messages, tools: deps.tools.list(),
          memories: [], config: deps.config as any, feedbackState,
        });

        // 2. Call LLM
        const response: AgentResponse = await deps.llm.sendMessage(context);
        const parsed = parseResponse(response);
        messages.push({ role: 'assistant', content: response.content });

        // 3. Execute tool calls
        for (const tc of response.toolCalls) {
          // Pre-check (guardrail)
          if (!deps.governance.preCheck(tc)) {
            // Blocked — wait for user approval
            return { status: 'blocked', session: buildSession() };
          }

          // Execute tool
          const startTime = Date.now();
          let result;
          try {
            result = await deps.tools.execute(tc.name, tc.arguments);
          } catch (err: any) {
            result = { success: false, output: '', error: err.message };
          }

          toolCalls.push({
            timestamp: new Date(),
            toolName: tc.name,
            params: tc.arguments,
            result,
            guardrailCheck: 'passed',
          });

          messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            toolCallId: tc.id,
            name: tc.name,
          });

          // 4. If tests were run, trigger feedback loop
          if (tc.name === 'run_tests') {
            const fbResult = await deps.feedback.run(workingDir, feedbackState);
            const fbRun: FeedbackRun = {
              iteration,
              testResult: fbResult.status === 'pass' ? 'pass' : 'fail',
              failureCount: fbResult.failures.length,
              fixApplied: false,
              timeSpent: Date.now() - startTime,
            };
            feedbackRuns.push(fbRun);

            if (fbResult.status === 'pass') {
              testPassed = true;
            } else {
              testPassed = false;
            }

            feedbackState = {
              lastResult: fbResult,
              iteration,
            };
          }
        }

        // 5. Check stop condition (increment first so iteration count matches actual runs)
        iteration++;

        const stopResult = deps.stopCondition.check({
          isComplete: parsed.isComplete,
          testPassed,
          currentIteration: iteration,
          maxIterations: deps.config.maxIterations,
          hitlState: deps.governance.hitl.state,
        });

        if (stopResult.shouldStop) {
          const statusMap: Record<string, AgentLoopResult['status']> = {
            task_complete: 'completed',
            max_iterations: 'max_iterations',
            blocked_waiting: 'blocked',
          };
          return {
            status: statusMap[stopResult.reason!] || 'failed',
            session: buildSession(),
          };
        }
      }

      return { status: 'failed', session: buildSession() };

      function buildSession(): Session {
        return {
          id: generateId(),
          createdAt: new Date(),
          task,
          messages,
          toolCalls: toolCalls as any,
          feedbackRuns,
          status: 'completed',
          conclusion: null,
        };
      }
    },

    handleApproval(approved: boolean) {
      if (approved) deps.governance.hitl.approve();
      else deps.governance.hitl.reject();
      deps.governance.hitl.reset();
    },

    abort() {
      aborted = true;
    },
  };
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2);
}