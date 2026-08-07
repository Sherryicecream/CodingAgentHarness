import { AgentContext, AgentLoopResult, AgentResponse, Message, Session, ToolCallRecord, FeedbackRun, FeedbackResult } from '../types.js';
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
  /** Optional callback for real-time progress events */
  onEvent?: (type: string, data: any) => void;
}

export interface AgentLoop {
  run(task: string, workingDir: string): Promise<AgentLoopResult>;
  handleApproval(approved: boolean): void;
  abort(): void;
}

/**
 * Check if a shell command looks like a test command.
 */
function isTestCommand(command: string): boolean {
  const lower = command.toLowerCase();
  // Match: node *test*, npx test, npm test, vitest, jest, *test.js, *test.ts, *spec.js, *spec.ts
  return /\b(test|assert|spec)\b/.test(lower)
    || /node\s+.*\.test\.(js|ts|mjs)/.test(lower)
    || /node\s+.*\.spec\.(js|ts|mjs)/.test(lower)
    || /^(npx|npm)\s+(test|vitest|jest|run test)/.test(lower);
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
        deps.onEvent?.('loop_step', { iteration, phase: 'calling_llm' });
        const response: AgentResponse = await deps.llm.sendMessage(context);
        const parsed = parseResponse(response);
        deps.onEvent?.('loop_step', { iteration, content: response.content?.slice(0, 300) });
        messages.push({
          role: 'assistant' as const,
          content: response.content,
          ...(response.toolCalls.length > 0 ? { toolCalls: response.toolCalls } : {}),
        });

        // 3. Execute tool calls
        for (const tc of response.toolCalls) {
          // Pre-check (guardrail)
          if (!deps.governance.preCheck(tc)) {
            deps.onEvent?.('guardrail', { toolCall: tc, decision: 'blocked' });
            return { status: 'blocked', session: buildSession('blocked') };
          }

          // Execute tool
          const startTime = Date.now();
          let result;
          try {
            deps.onEvent?.('tool_call', { name: tc.name, arguments: tc.arguments, status: 'running' });
            result = await deps.tools.execute(tc.name, tc.arguments);
          } catch (err: any) {
            result = { success: false, output: '', error: err.message };
          }
          deps.onEvent?.('tool_call', { name: tc.name, arguments: tc.arguments, result, status: 'done' });

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
          // Trigger on both `run_tests` tool and `execute_shell` with test commands
          const isTestRun = tc.name === 'run_tests'
            || (tc.name === 'execute_shell' && isTestCommand(String(tc.arguments?.command || '')));

          if (isTestRun) {
            let fbResult: FeedbackResult;
            if (tc.name === 'run_tests') {
              fbResult = await deps.feedback.run(workingDir, feedbackState);
            } else {
              // For execute_shell test commands, parse the output directly
              fbResult = deps.feedback.parseOutput(
                result?.output || '',
                result?.error || '',
                result?.success !== false ? 0 : 1,
              );
            }

            const fbRun: FeedbackRun = {
              iteration,
              testResult: fbResult.status === 'pass' ? 'pass' : 'fail',
              failureCount: fbResult.failures.length,
              fixApplied: false,
              timeSpent: Date.now() - startTime,
            };
            feedbackRuns.push(fbRun);
            deps.onEvent?.('feedback', { status: fbResult.status, failures: fbResult.failures, iteration });

            if (fbResult.status === 'pass') {
              testPassed = true;
            } else {
              testPassed = false;
            }

            feedbackState = {
              lastResult: fbResult,
              iteration,
            };

            // Check feedback loop's shouldContinue (respects maxIterations cap)
            // If the feedback loop says we should not continue, stop the entire agent loop
            if (!deps.feedback.shouldContinue(fbResult, feedbackState, deps.config.maxIterations)) {
              if (fbResult.status === 'fail') {
                testPassed = false;
              }
            }
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
            session: buildSession(statusMap[stopResult.reason!] || 'failed'),
          };
        }
      }

      return { status: 'failed', session: buildSession('failed') };

      function buildSession(actualStatus: string): Session {
        return {
          id: generateId(),
          createdAt: new Date(),
          task,
          messages,
          toolCalls,
          feedbackRuns,
          status: actualStatus as Session['status'],
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