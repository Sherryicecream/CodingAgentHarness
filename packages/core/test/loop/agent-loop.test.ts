import { describe, it, expect, beforeEach } from 'vitest';
import { createAgentLoop, AgentLoop, AgentLoopDependencies } from '../../src/loop/agent-loop.js';
import { MockLLMAdapter } from '../../src/llm/mock.js';
import { createToolRegistry, ToolApprovalRequiredError, ToolRegistry } from '../../src/tools/tool.js';
import { createGovernanceService, GovernanceService } from '../../src/guardrail/index.js';
import { createContextBuilder, ContextBuilder } from '../../src/loop/context-builder.js';
import { createStopCondition, StopCondition } from '../../src/loop/stop-condition.js';
import { FeedbackLoop } from '../../src/feedback/feedback-loop.js';
import { AgentResponse, Tool, ToolResult, FeedbackResult, FeedbackState } from '../../src/types.js';

function makeResponse(content: string, toolCalls: any[] = []): AgentResponse {
  return { content, toolCalls };
}

function makeToolCall(id: string, name: string, args: Record<string, unknown> = {}) {
  return { id, name, arguments: args };
}

function makeMockFeedbackLoop(testStatus: 'pass' | 'fail' = 'pass'): FeedbackLoop {
  return {
    async run(_workingDir: string, _state: FeedbackState | null): Promise<FeedbackResult> {
      return {
        status: testStatus,
        failures: [],
        actionableFix: null,
      };
    },
    shouldContinue(_result: FeedbackResult, _state: FeedbackState | null, _maxIterations: number): boolean {
      return false;
    },
  };
}

function makeFailingMockFeedbackLoop(): FeedbackLoop {
  return {
    async run(_workingDir: string, _state: FeedbackState | null): Promise<FeedbackResult> {
      return {
        status: 'fail',
        failures: [
          { file: 'test.ts', line: 10, type: 'assertion', message: 'Expected true but got false', diff: '- true\n+ false' },
        ],
        actionableFix: {
          summary: 'Fix assertion',
          failures: [],
          suggestedActions: ['Fix the test'],
        },
      };
    },
    shouldContinue(_result: FeedbackResult, _state: FeedbackState | null, _maxIterations: number): boolean {
      return true;
    },
  };
}

function makeWriteFileTool(): Tool {
  return {
    definition: {
      name: 'write_file',
      description: 'Write content to a file',
      parameters: { path: 'string', content: 'string' },
    },
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      return { success: true, output: `File written: ${params.path}` };
    },
    riskLevel: 'safe',
  };
}

function makeRunTestsTool(): Tool {
  return {
    definition: {
      name: 'run_tests',
      description: 'Run test suite',
      parameters: {},
    },
    async execute(_params: Record<string, unknown>): Promise<ToolResult> {
      return { success: true, output: 'All tests passed' };
    },
    riskLevel: 'safe',
  };
}

function makeDangerousTool(): Tool {
  return {
    definition: {
      name: 'execute_shell',
      description: 'Execute shell command',
      parameters: { command: 'string' },
    },
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      return { success: true, output: `Executed: ${params.command}` };
    },
    riskLevel: 'dangerous',
  };
}

function buildDeps(overrides: Partial<AgentLoopDependencies> & {
  llm: AgentLoopDependencies['llm'];
  tools: ToolRegistry;
  governance: GovernanceService;
  feedback: FeedbackLoop;
  contextBuilder: ContextBuilder;
  stopCondition: StopCondition;
}): AgentLoopDependencies {
  return {
    config: { maxIterations: 20 },
    ...overrides,
  };
}

describe('AgentLoop', () => {
  // ── Test 1: Simple task — LLM responds with TASK_COMPLETE, loop ends with "completed" ──
  describe('simple task completion', () => {
    it('should complete when LLM responds with TASK_COMPLETE', async () => {
      const llm = new MockLLMAdapter([
        makeResponse('Task is done. TASK_COMPLETE'),
      ]);
      const tools = createToolRegistry();
      const governance = createGovernanceService();
      const feedback = makeMockFeedbackLoop();
      const contextBuilder = createContextBuilder();
      const stopCondition = createStopCondition();

      const loop = createAgentLoop(buildDeps({ llm, tools, governance, feedback, contextBuilder, stopCondition }));

      const result = await loop.run('Write a hello world program', '/tmp/test');

      expect(result.status).toBe('completed');
      expect(result.session.messages).toHaveLength(1);
      expect(result.session.messages[0].role).toBe('assistant');
      expect(result.session.messages[0].content).toContain('TASK_COMPLETE');
    });

    it('should complete when LLM returns text-only response with TASK_COMPLETE marker', async () => {
      const llm = new MockLLMAdapter([
        makeResponse('Here is the final answer. TASK_COMPLETE'),
      ]);
      const tools = createToolRegistry();
      const governance = createGovernanceService();
      const feedback = makeMockFeedbackLoop();
      const contextBuilder = createContextBuilder();
      const stopCondition = createStopCondition();

      const loop = createAgentLoop(buildDeps({ llm, tools, governance, feedback, contextBuilder, stopCondition }));

      const result = await loop.run('Answer a question', '/tmp/test');

      expect(result.status).toBe('completed');
      expect(result.session.messages).toHaveLength(1);
    });
  });

  // ── Test 2: Tool call — LLM calls write_file, tool executed, result recorded ──
  describe('tool execution', () => {
    it('should execute write_file tool and record result', async () => {
      const llm = new MockLLMAdapter([
        makeResponse('I will write the file. TASK_COMPLETE', [
          makeToolCall('call_1', 'write_file', { path: '/tmp/hello.ts', content: 'console.log("hello")' }),
        ]),
      ]);
      const tools = createToolRegistry();
      tools.register(makeWriteFileTool());
      const governance = createGovernanceService();
      const feedback = makeMockFeedbackLoop();
      const contextBuilder = createContextBuilder();
      const stopCondition = createStopCondition();

      const loop = createAgentLoop(buildDeps({ llm, tools, governance, feedback, contextBuilder, stopCondition }));

      const result = await loop.run('Write a file', '/tmp/test');

      expect(result.status).toBe('completed');
      // Should have assistant message + tool result message
      expect(result.session.messages).toHaveLength(2);
      expect(result.session.messages[1].role).toBe('tool');
      expect(result.session.messages[1].name).toBe('write_file');

      // Tool call should be recorded
      expect(result.session.toolCalls).toHaveLength(1);
      expect(result.session.toolCalls[0].toolName).toBe('write_file');
      expect(result.session.toolCalls[0].result.success).toBe(true);
    });

    it('should handle tool execution error gracefully', async () => {
      const llm = new MockLLMAdapter([
        makeResponse('I will try to run a tool. TASK_COMPLETE', [
          makeToolCall('call_1', 'nonexistent_tool', { arg: 'value' }),
        ]),
      ]);
      const tools = createToolRegistry();
      // Don't register the tool — it will throw ToolNotFoundError
      const governance = createGovernanceService();
      const feedback = makeMockFeedbackLoop();
      const contextBuilder = createContextBuilder();
      const stopCondition = createStopCondition();

      const loop = createAgentLoop(buildDeps({ llm, tools, governance, feedback, contextBuilder, stopCondition }));

      const result = await loop.run('Run a missing tool', '/tmp/test');

      // Should still complete because the error is caught
      expect(result.session.toolCalls).toHaveLength(1);
      expect(result.session.toolCalls[0].result.success).toBe(false);
      expect(result.session.toolCalls[0].result.error).toBeDefined();
    });
  });

  // ── Test 3: Feedback loop triggers — LLM calls run_tests, feedback runs, feedbackState injected ──
  describe('feedback loop integration', () => {
    it('should trigger feedback loop when run_tests tool is called (passing)', async () => {
      const llm = new MockLLMAdapter([
        makeResponse('I will run the tests. TASK_COMPLETE', [
          makeToolCall('call_1', 'run_tests', {}),
        ]),
      ]);
      const tools = createToolRegistry();
      tools.register(makeRunTestsTool());
      const governance = createGovernanceService();
      const feedback = makeMockFeedbackLoop('pass');
      const contextBuilder = createContextBuilder();
      const stopCondition = createStopCondition();

      const loop = createAgentLoop(buildDeps({ llm, tools, governance, feedback, contextBuilder, stopCondition }));

      const result = await loop.run('Run tests', '/tmp/test');

      expect(result.status).toBe('completed');
      // Should have feedback run recorded
      expect(result.session.feedbackRuns).toHaveLength(1);
      expect(result.session.feedbackRuns[0].testResult).toBe('pass');
      expect(result.session.feedbackRuns[0].iteration).toBe(0);
    });

    it('should trigger feedback loop when run_tests tool is called (failing then passing)', async () => {
      const llm = new MockLLMAdapter([
        // First response: run tests, they fail
        makeResponse('Running tests...', [
          makeToolCall('call_1', 'run_tests', {}),
        ]),
        // Second response: fix code, run tests again, they pass
        makeResponse('Fixed the code. TASK_COMPLETE', [
          makeToolCall('call_2', 'run_tests', {}),
        ]),
      ]);
      const tools = createToolRegistry();
      tools.register(makeRunTestsTool());
      const governance = createGovernanceService();
      // First call returns fail, second returns pass
      let callCount = 0;
      const alternatingFeedback: FeedbackLoop = {
        async run(_workingDir: string, _state: FeedbackState | null): Promise<FeedbackResult> {
          callCount++;
          if (callCount === 1) {
            return {
              status: 'fail',
              failures: [{ file: 'test.ts', line: 10, type: 'assertion', message: 'Expected true', diff: '' }],
              actionableFix: { summary: 'Fix', failures: [], suggestedActions: [] },
            };
          }
          return { status: 'pass', failures: [], actionableFix: null };
        },
        shouldContinue(_result: FeedbackResult, _state: FeedbackState | null, _maxIterations: number): boolean {
          return false;
        },
      };
      const contextBuilder = createContextBuilder();
      const stopCondition = createStopCondition();

      const loop = createAgentLoop(buildDeps({ llm, tools, governance, feedback: alternatingFeedback, contextBuilder, stopCondition }));

      const result = await loop.run('Run failing tests then fix', '/tmp/test');

      expect(result.status).toBe('completed');
      // Should have 2 feedback runs recorded
      expect(result.session.feedbackRuns).toHaveLength(2);
      expect(result.session.feedbackRuns[0].testResult).toBe('fail');
      expect(result.session.feedbackRuns[0].failureCount).toBe(1);
      expect(result.session.feedbackRuns[1].testResult).toBe('pass');
      expect(result.session.feedbackRuns[1].failureCount).toBe(0);
    });
  });

  // ── Test 4: Guardrail blocks — LLM calls dangerous command, loop returns "blocked" status ──
  describe('guardrail blocking', () => {
    it('should return blocked status when guardrail blocks a dangerous command', async () => {
      const llm = new MockLLMAdapter([
        makeResponse('I will delete everything.', [
          makeToolCall('call_1', 'execute_shell', { command: 'rm -rf /' }),
        ]),
      ]);
      const tools = createToolRegistry();
      tools.register(makeDangerousTool());
      const governance = createGovernanceService({ blockedCommands: [] });
      const feedback = makeMockFeedbackLoop();
      const contextBuilder = createContextBuilder();
      const stopCondition = createStopCondition();

      const loop = createAgentLoop(buildDeps({ llm, tools, governance, feedback, contextBuilder, stopCondition }));

      const result = await loop.run('Delete files', '/tmp/test');

      expect(result.status).toBe('blocked');
      // The tool call should NOT have been executed
      expect(result.session.toolCalls).toHaveLength(0);
    });

    it('should require approval for a harmless command from a dangerous tool', async () => {
      const llm = new MockLLMAdapter([
        makeResponse('I will list files. TASK_COMPLETE', [
          makeToolCall('call_1', 'execute_shell', { command: 'ls -la' }),
        ]),
      ]);
      const tools = createToolRegistry();
      tools.register(makeDangerousTool());
      const governance = createGovernanceService({ blockedCommands: [] });
      const feedback = makeMockFeedbackLoop();
      const contextBuilder = createContextBuilder();
      const stopCondition = createStopCondition();

      const loop = createAgentLoop(buildDeps({ llm, tools, governance, feedback, contextBuilder, stopCondition }));

      const result = await loop.run('List files', '/tmp/test');

      expect(result.status).toBe('blocked');
      expect(result.session.toolCalls).toHaveLength(0);
      expect(governance.hitl.state).toBe('waiting_user');
    });
  });

  // ── Test 5: Max iterations — simulate 20 iterations, loop ends with "max_iterations" ──
  describe('max iterations', () => {
    it('should stop with max_iterations when iteration limit is reached', async () => {
      // Create 20 responses that always have tool calls (so loop never completes)
      const responses: AgentResponse[] = [];
      for (let i = 0; i < 20; i++) {
        responses.push(makeResponse(`Iteration ${i}`, [
          makeToolCall(`call_${i}`, 'write_file', { path: `/tmp/file_${i}.ts`, content: 'code' }),
        ]));
      }

      const llm = new MockLLMAdapter(responses);
      const tools = createToolRegistry();
      tools.register(makeWriteFileTool());
      const governance = createGovernanceService();
      const feedback = makeMockFeedbackLoop();
      const contextBuilder = createContextBuilder();
      const stopCondition = createStopCondition();

      const loop = createAgentLoop(buildDeps({
        llm, tools, governance, feedback, contextBuilder, stopCondition,
        config: { maxIterations: 20 },
      }));

      const result = await loop.run('Keep writing files', '/tmp/test');

      expect(result.status).toBe('max_iterations');
      // Should have 20 iterations of messages (assistant + tool = 40 messages)
      expect(result.session.messages).toHaveLength(40);
      expect(result.session.toolCalls).toHaveLength(20);
    });

    it('should stop at exactly maxIterations', async () => {
      const responses: AgentResponse[] = [];
      for (let i = 0; i < 5; i++) {
        responses.push(makeResponse(`Iteration ${i}`, [
          makeToolCall(`call_${i}`, 'write_file', { path: `/tmp/f${i}.ts`, content: 'code' }),
        ]));
      }

      const llm = new MockLLMAdapter(responses);
      const tools = createToolRegistry();
      tools.register(makeWriteFileTool());
      const governance = createGovernanceService();
      const feedback = makeMockFeedbackLoop();
      const contextBuilder = createContextBuilder();
      const stopCondition = createStopCondition();

      const loop = createAgentLoop(buildDeps({
        llm, tools, governance, feedback, contextBuilder, stopCondition,
        config: { maxIterations: 5 },
      }));

      const result = await loop.run('Write some files', '/tmp/test');

      expect(result.status).toBe('max_iterations');
      expect(result.session.toolCalls).toHaveLength(5);
    });
  });

  // ── Additional tests: abort and handleApproval ──
  describe('abort', () => {
    it('does not request approval after aborting from the running event', async () => {
      let executions = 0;
      const dangerousTool = makeDangerousTool();
      const tools = createToolRegistry();
      tools.register({
        ...dangerousTool,
        async execute(params) {
          executions += 1;
          return dangerousTool.execute(params);
        },
      });
      const governance = createGovernanceService({ blockedCommands: [] });
      let loop!: AgentLoop;
      loop = createAgentLoop({
        ...buildDeps({
          llm: new MockLLMAdapter([makeResponse('Approval is required.', [
            makeToolCall('abort-running', 'execute_shell', { command: 'echo hello' }),
          ])]),
          tools,
          governance,
          feedback: makeMockFeedbackLoop(),
          contextBuilder: createContextBuilder(),
          stopCondition: createStopCondition(),
        }),
        onEvent(type, data) {
          if (type === 'tool_call' && data.status === 'running') {
            loop.abort();
          }
        },
      });

      const result = await loop.run('Abort before authorization', '/tmp/test');

      expect(result.status).toBe('failed');
      expect(executions).toBe(0);
      expect(governance.hitl.state).toBe('running');
      expect(governance.hitl.pendingAction).toBeNull();
      await expect(loop.continueAfterApproval(true)).rejects.toThrow(
        'Agent loop has no blocked action to continue',
      );
    });

    it('clears an approved action that aborts before execution', async () => {
      const tools = createToolRegistry();
      tools.register(makeDangerousTool());
      const governance = createGovernanceService({ blockedCommands: [] });
      const loop = createAgentLoop(buildDeps({
        llm: new MockLLMAdapter([makeResponse('Approval is required.', [
          makeToolCall('abort-approved', 'execute_shell', { command: 'echo hello' }),
        ])]),
        tools,
        governance,
        feedback: makeMockFeedbackLoop(),
        contextBuilder: createContextBuilder(),
        stopCondition: createStopCondition(),
      }));

      await loop.run('Require approval then abort', '/tmp/test');
      governance.hitl.approve();
      loop.abort();

      await expect(tools.execute('execute_shell', { command: 'echo hello' }, {
        toolCallId: 'abort-approved',
      })).rejects.toThrow(ToolApprovalRequiredError);
    });

    it('should abort the loop mid-execution', async () => {
      const llm = new MockLLMAdapter([
        makeResponse('Processing...', [
          makeToolCall('call_1', 'write_file', { path: '/tmp/test.ts', content: 'code' }),
        ]),
        makeResponse('TASK_COMPLETE'),
      ]);
      const tools = createToolRegistry();
      tools.register(makeWriteFileTool());
      const governance = createGovernanceService();
      const feedback = makeMockFeedbackLoop();
      const contextBuilder = createContextBuilder();
      const stopCondition = createStopCondition();

      const loop = createAgentLoop(buildDeps({ llm, tools, governance, feedback, contextBuilder, stopCondition }));

      // Abort after first iteration — the loop will stop on the next while check
      // We need to abort before the loop starts. Let's rely on the abort flag.
      loop.abort();

      const result = await loop.run('Aborted task', '/tmp/test');

      expect(result.status).toBe('failed');
      // No messages should be processed because loop was aborted before first iteration
      expect(result.session.messages).toHaveLength(0);
    });

    it('does not execute tool calls returned after an in-flight abort', async () => {
      let resolveResponse!: (response: AgentResponse) => void;
      let markRequestStarted!: () => void;
      const requestStarted = new Promise<void>((resolve) => { markRequestStarted = resolve; });
      const response = new Promise<AgentResponse>((resolve) => { resolveResponse = resolve; });
      const llm = {
        async sendMessage() {
          markRequestStarted();
          return response;
        },
      };
      let executions = 0;
      const tools = createToolRegistry();
      const writeTool = makeWriteFileTool();
      tools.register({
        ...writeTool,
        async execute(params) {
          executions += 1;
          return writeTool.execute(params);
        },
      });
      const loop = createAgentLoop(buildDeps({
        llm,
        tools,
        governance: createGovernanceService(),
        feedback: makeMockFeedbackLoop(),
        contextBuilder: createContextBuilder(),
        stopCondition: createStopCondition(),
      }));

      const completion = loop.run('write after network response', '/tmp/test');
      await requestStarted;
      loop.abort();
      resolveResponse(makeResponse('TASK_COMPLETE', [
        makeToolCall('late-call', 'write_file', { path: '/tmp/late.ts', content: 'late' }),
      ]));
      const result = await completion;

      expect(result.status).toBe('failed');
      expect(executions).toBe(0);
      expect(result.session.toolCalls).toHaveLength(0);
    });

    it('does not emit or record a tool result that returns after abort', async () => {
      let markToolStarted!: () => void;
      const toolStarted = new Promise<void>((resolve) => { markToolStarted = resolve; });
      let resolveTool!: (result: ToolResult) => void;
      const pendingTool = new Promise<ToolResult>((resolve) => { resolveTool = resolve; });
      const tools = createToolRegistry();
      tools.register({
        ...makeWriteFileTool(),
        execute: () => {
          markToolStarted();
          return pendingTool;
        },
      });
      const events: Array<{ type: string; data: unknown }> = [];
      const loop = createAgentLoop({
        ...buildDeps({
          llm: new MockLLMAdapter([makeResponse('working', [
            makeToolCall('pending-tool', 'write_file', { path: 'late.txt' }),
          ])]),
          tools,
          governance: createGovernanceService(),
          feedback: makeMockFeedbackLoop(),
          contextBuilder: createContextBuilder(),
          stopCondition: createStopCondition(),
        }),
        onEvent: (type, data) => { events.push({ type, data }); },
      });
      const completion = loop.run('wait for tool', '/tmp/test');
      await toolStarted;
      loop.abort();
      const eventCountAtAbort = events.length;

      resolveTool({ success: true, output: 'sk-test-late-tool-sentinel' });
      const result = await completion;

      expect(result.status).toBe('failed');
      expect(events).toHaveLength(eventCountAtAbort);
      expect(JSON.stringify(events)).not.toContain('sk-test-late-tool-sentinel');
      expect(result.session.toolCalls).toHaveLength(0);
      expect(result.session.messages.some((message) => message.role === 'tool')).toBe(false);
    });
  });

  describe('handleApproval', () => {
    it('should approve a blocked action after guardrail blocks', async () => {
      const tools = createToolRegistry();
      tools.register(makeDangerousTool());
      const governance = createGovernanceService({ blockedCommands: [] });
      const feedback = makeMockFeedbackLoop();
      const contextBuilder = createContextBuilder();
      const stopCondition = createStopCondition();
      const llm = new MockLLMAdapter([
        makeResponse('I will delete everything.', [
          makeToolCall('call_1', 'execute_shell', { command: 'rm -rf /' }),
        ]),
      ]);

      const loop = createAgentLoop(buildDeps({ llm, tools, governance, feedback, contextBuilder, stopCondition }));

      // Run the loop - it should block on the dangerous command
      const result = await loop.run('Delete files', '/tmp/test');
      expect(result.status).toBe('blocked');

      // Now HITL should be in waiting_user state
      // Approve the blocked action
      expect(() => loop.handleApproval(true)).not.toThrow();
    });

    it('continues a blocked run after approval without replaying completed work', async () => {
      let dangerousExecutions = 0;
      const dangerousTool = makeDangerousTool();
      const tools = createToolRegistry();
      tools.register({
        ...dangerousTool,
        async execute(params) {
          dangerousExecutions += 1;
          return dangerousTool.execute(params);
        },
      });
      const governance = createGovernanceService({ blockedCommands: [] });
      const llm = new MockLLMAdapter([
        makeResponse('Approval is required.', [
          makeToolCall('call_1', 'execute_shell', { command: 'rm -rf /tmp/owned-target' }),
        ]),
        makeResponse('Approved action completed. TASK_COMPLETE'),
      ]);
      const loop = createAgentLoop(buildDeps({
        llm,
        tools,
        governance,
        feedback: makeMockFeedbackLoop(),
        contextBuilder: createContextBuilder(),
        stopCondition: createStopCondition(),
      }));

      const blocked = await loop.run('Delete the owned target', '/tmp/test');
      const completed = await loop.continueAfterApproval(true);

      expect(blocked.status).toBe('blocked');
      expect(completed.status).toBe('completed');
      expect(dangerousExecutions).toBe(1);
      expect(completed.session.toolCalls).toHaveLength(1);
      expect(completed.session.toolCalls[0].toolName).toBe('execute_shell');
      expect(llm.remainingCount).toBe(0);
    });

    it('preserves exact progress across two approvals in one multi-action response', async () => {
      const executions: string[] = [];
      const safeTool = makeWriteFileTool();
      const dangerousTool = makeDangerousTool();
      const tools = createToolRegistry();
      tools.register({
        ...safeTool,
        async execute(params) {
          executions.push(String(params.path));
          return safeTool.execute(params);
        },
      });
      tools.register({
        ...dangerousTool,
        async execute(params) {
          executions.push(String(params.command));
          return dangerousTool.execute(params);
        },
      });
      const loop = createAgentLoop(buildDeps({
        llm: new MockLLMAdapter([
          makeResponse('Run the ordered actions.', [
            makeToolCall('safe', 'write_file', { path: 'safe.txt', content: 'safe' }),
            makeToolCall('first-risk', 'execute_shell', { command: 'rm -rf first-owned-target' }),
            makeToolCall('second-risk', 'execute_shell', { command: 'rm -rf second-owned-target' }),
          ]),
          makeResponse('All approved actions completed. TASK_COMPLETE'),
        ]),
        tools,
        governance: createGovernanceService({ blockedCommands: [] }),
        feedback: makeMockFeedbackLoop(),
        contextBuilder: createContextBuilder(),
        stopCondition: createStopCondition(),
      }));

      const firstBlock = await loop.run('Run three ordered actions', '/tmp/test');
      const secondBlock = await loop.continueAfterApproval(true);
      const completed = await loop.continueAfterApproval(true);

      expect(firstBlock.status).toBe('blocked');
      expect(secondBlock.status).toBe('blocked');
      expect(completed.status).toBe('completed');
      expect(executions).toEqual([
        'safe.txt',
        'rm -rf first-owned-target',
        'rm -rf second-owned-target',
      ]);
      expect(completed.session.toolCalls.map((call) => call.guardrailCheck)).toEqual([
        'passed',
        'approved_by_user',
        'approved_by_user',
      ]);
    });

    it('should throw when handleApproval called without pending block', () => {
      const tools = createToolRegistry();
      const governance = createGovernanceService();
      const feedback = makeMockFeedbackLoop();
      const contextBuilder = createContextBuilder();
      const stopCondition = createStopCondition();
      const llm = new MockLLMAdapter([]);

      const loop = createAgentLoop(buildDeps({ llm, tools, governance, feedback, contextBuilder, stopCondition }));

      // handleApproval should throw when HITL is not in waiting_user state
      expect(() => loop.handleApproval(true)).toThrow();
    });
  });
});
