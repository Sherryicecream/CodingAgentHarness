import { describe, it, expect } from 'vitest';
import type {
  LLMAdapter,
  AgentContext,
  AgentResponse,
  ToolCallRequest,
  Message,
  ToolDefinition,
  Tool,
  ToolResult,
  RiskLevel,
  GuardrailDecision,
  HITLState,
  FeedbackResult,
  TestFailure,
  FixSuggestion,
  FeedbackState,
  MemoryEntry,
  AgentConfig,
  Session,
  ToolCallRecord,
  FeedbackRun,
  AgentLoopResult,
} from '../src/types.js';

// ── Compile-time verification: each type can be instantiated ──

describe('Core types', () => {
  it('should allow creating a valid Message', () => {
    const msg: Message = { role: 'user', content: 'Hello' };
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello');
  });

  it('should allow creating a Message with optional fields', () => {
    const msg: Message = {
      role: 'tool',
      content: 'result',
      toolCallId: 'tc_1',
      name: 'read_file',
    };
    expect(msg.toolCallId).toBe('tc_1');
    expect(msg.name).toBe('read_file');
  });

  it('should allow creating a ToolCallRequest', () => {
    const req: ToolCallRequest = {
      id: 'call_1',
      name: 'read_file',
      arguments: { path: '/tmp/test.ts' },
    };
    expect(req.id).toBe('call_1');
    expect(req.arguments).toEqual({ path: '/tmp/test.ts' });
  });

  it('should allow creating an AgentResponse', () => {
    const resp: AgentResponse = {
      content: 'Done',
      toolCalls: [],
    };
    expect(resp.content).toBe('Done');
    expect(resp.toolCalls).toHaveLength(0);
  });

  it('should allow creating an AgentResponse with tool calls', () => {
    const resp: AgentResponse = {
      content: '',
      toolCalls: [{ id: 'tc_1', name: 'write_file', arguments: { path: 'x.ts', content: 'x' } }],
    };
    expect(resp.toolCalls).toHaveLength(1);
  });

  it('should allow creating a ToolDefinition', () => {
    const def: ToolDefinition = {
      name: 'read_file',
      description: 'Read a file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    };
    expect(def.name).toBe('read_file');
  });

  it('should allow creating a Tool', () => {
    const tool: Tool = {
      definition: {
        name: 'echo',
        description: 'Echo back',
        parameters: {},
      },
      execute: async (_params) => ({ success: true, output: 'echo' }),
      riskLevel: 'safe' as RiskLevel,
    };
    expect(tool.riskLevel).toBe('safe');
  });

  it('should allow creating a ToolResult', () => {
    const result: ToolResult = { success: true, output: 'OK' };
    expect(result.success).toBe(true);
  });

  it('should allow creating a ToolResult with error', () => {
    const result: ToolResult = {
      success: false,
      output: '',
      error: 'File not found',
    };
    expect(result.error).toBe('File not found');
  });

  it('should allow creating a FeedbackResult', () => {
    const fr: FeedbackResult = {
      status: 'fail',
      failures: [{ file: 'a.ts', line: 1, type: 'assertion', message: 'fail', diff: 'diff' }],
      actionableFix: null,
    };
    expect(fr.status).toBe('fail');
  });

  it('should allow creating a TestFailure', () => {
    const tf: TestFailure = {
      file: 'test.ts',
      line: 42,
      type: 'syntax',
      message: 'Unexpected token',
      diff: '- expected\n+ actual',
    };
    expect(tf.type).toBe('syntax');
  });

  it('should allow creating a FixSuggestion', () => {
    const fs: FixSuggestion = {
      summary: 'Fix syntax error',
      failures: [],
      suggestedActions: ['Fix the typo on line 42'],
    };
    expect(fs.summary).toBe('Fix syntax error');
  });

  it('should allow creating a FeedbackState', () => {
    const state: FeedbackState = {
      lastResult: {
        status: 'fail',
        failures: [],
        actionableFix: null,
      },
      iteration: 1,
    };
    expect(state.iteration).toBe(1);
  });

  it('should allow creating a MemoryEntry', () => {
    const mem: MemoryEntry = {
      id: 'mem_1',
      type: 'convention',
      content: 'Use tabs for indentation',
      source: 'user',
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    };
    expect(mem.type).toBe('convention');
  });

  it('should allow creating an AgentConfig', () => {
    const config: AgentConfig = {
      maxIterations: 20,
      testCommand: 'npm test',
      allowedTools: ['*'],
      blockedCommands: ['rm -rf'],
      ignoredPaths: ['node_modules', '.git'],
    };
    expect(config.maxIterations).toBe(20);
  });

  it('should allow creating a Session', () => {
    const session: Session = {
      id: 'sess_1',
      createdAt: new Date(),
      task: 'Write a hello world',
      messages: [],
      toolCalls: [],
      feedbackRuns: [],
      status: 'running',
      conclusion: null,
    };
    expect(session.status).toBe('running');
  });

  it('should allow creating a ToolCallRecord', () => {
    const record: ToolCallRecord = {
      timestamp: new Date(),
      toolName: 'read_file',
      params: { path: '/x' },
      result: { success: true, output: 'content' },
      guardrailCheck: 'passed',
    };
    expect(record.guardrailCheck).toBe('passed');
  });

  it('should allow creating a FeedbackRun', () => {
    const run: FeedbackRun = {
      iteration: 1,
      testResult: 'pass',
      failureCount: 0,
      fixApplied: false,
      timeSpent: 1500,
    };
    expect(run.testResult).toBe('pass');
  });

  it('should allow creating an AgentLoopResult', () => {
    const result: AgentLoopResult = {
      status: 'completed',
      session: {
        id: 'sess_1',
        createdAt: new Date(),
        task: 'task',
        messages: [],
        toolCalls: [],
        feedbackRuns: [],
        status: 'completed',
        conclusion: 'All done',
      },
    };
    expect(result.status).toBe('completed');
  });

  // ── Compile-time: AgentContext must be accepted by a function ──

  it('should accept AgentContext in a function', () => {
    function handleContext(ctx: AgentContext): string {
      return `Messages: ${ctx.messages.length}, Tools: ${ctx.tools.length}`;
    }
    const ctx: AgentContext = {
      messages: [],
      tools: [],
      memory: [],
      config: {
        maxIterations: 10,
        testCommand: 'npm test',
        allowedTools: [],
        blockedCommands: [],
        ignoredPaths: [],
      },
      feedbackState: null,
    };
    expect(handleContext(ctx)).toBe('Messages: 0, Tools: 0');
  });

  // ── Compile-time: LLMAdapter must accept an AgentContext ──

  it('should allow LLMAdapter to accept AgentContext', async () => {
    const adapter: LLMAdapter = {
      sendMessage: async (_ctx: AgentContext): Promise<AgentResponse> => ({
        content: 'test',
        toolCalls: [],
      }),
    };
    const resp = await adapter.sendMessage({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      memory: [],
      config: {
        maxIterations: 10,
        testCommand: 'npm test',
        allowedTools: [],
        blockedCommands: [],
        ignoredPaths: [],
      },
      feedbackState: null,
    });
    expect(resp.content).toBe('test');
  });

  // ── Verify union types are assignable ──

  it('should accept RiskLevel values', () => {
    const levels: RiskLevel[] = ['safe', 'moderate', 'dangerous'];
    expect(levels).toHaveLength(3);
  });

  it('should accept GuardrailDecision values', () => {
    const decisions: GuardrailDecision[] = ['allowed', 'blocked', 'ask_user'];
    expect(decisions).toHaveLength(3);
  });

  it('should accept HITLState values', () => {
    const states: HITLState[] = ['running', 'blocked', 'waiting_user', 'approved', 'rejected'];
    expect(states).toHaveLength(5);
  });
});