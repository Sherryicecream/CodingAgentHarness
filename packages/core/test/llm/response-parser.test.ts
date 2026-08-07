import { describe, it, expect } from 'vitest';
import { parseResponse, ParsedResponse } from '../../src/llm/response-parser.js';
import { AgentResponse, ToolCallRequest } from '../../src/types.js';

function makeToolCall(id: string, name: string, args: Record<string, unknown> = {}): ToolCallRequest {
  return { id, name, arguments: args };
}

describe('parseResponse', () => {
  // 1. Text only, no tool calls → isComplete: false (must use TASK_COMPLETE marker)
  it('returns isComplete false for text-only response without completion marker', () => {
    const response: AgentResponse = {
      content: 'Here is the final answer to your question.',
      toolCalls: [],
    };

    const result = parseResponse(response);

    expect(result.text).toBe('Here is the final answer to your question.');
    expect(result.toolCalls).toEqual([]);
    expect(result.isComplete).toBe(false);
  });

  // 2. Contains tool calls → isComplete: false
  it('returns isComplete false when response has tool calls', () => {
    const toolCalls: ToolCallRequest[] = [
      makeToolCall('call_1', 'read_file', { path: '/src/index.ts' }),
      makeToolCall('call_2', 'search', { query: 'test' }),
    ];
    const response: AgentResponse = {
      content: 'I need to read the file first.',
      toolCalls,
    };

    const result = parseResponse(response);

    expect(result.text).toBe('I need to read the file first.');
    expect(result.toolCalls).toEqual(toolCalls);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.isComplete).toBe(false);
  });

  // 3. Contains "TASK_COMPLETE" marker → isComplete: true
  it('detects TASK_COMPLETE marker (uppercase)', () => {
    const response: AgentResponse = {
      content: 'The task has been finished. TASK_COMPLETE',
      toolCalls: [],
    };

    const result = parseResponse(response);

    expect(result.isComplete).toBe(true);
  });

  it('detects TASK_COMPLETE marker (lowercase)', () => {
    const response: AgentResponse = {
      content: 'All done. task_complete',
      toolCalls: [],
    };

    const result = parseResponse(response);

    expect(result.isComplete).toBe(true);
  });

  it('detects TASK COMPLETE marker (with space)', () => {
    const response: AgentResponse = {
      content: 'Everything is done. TASK COMPLETE',
      toolCalls: [],
    };

    const result = parseResponse(response);

    expect(result.isComplete).toBe(true);
  });

  // 4. Contains "任务完成" marker → isComplete: true
  it('detects 任务完成 marker', () => {
    const response: AgentResponse = {
      content: '所有任务已经完成。任务完成',
      toolCalls: [],
    };

    const result = parseResponse(response);

    expect(result.isComplete).toBe(true);
  });

  // 5. Has tool calls AND completion marker → isComplete: true
  it('returns isComplete true when both tool calls and completion marker are present', () => {
    const toolCalls: ToolCallRequest[] = [
      makeToolCall('call_1', 'write_file', { path: '/out.txt' }),
    ];
    const response: AgentResponse = {
      content: 'Created the output file. TASK_COMPLETE',
      toolCalls,
    };

    const result = parseResponse(response);

    expect(result.isComplete).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
  });

  // 6. Empty content, no tool calls → isComplete: false
  it('returns isComplete false for empty content with no tool calls', () => {
    const response: AgentResponse = {
      content: '',
      toolCalls: [],
    };

    const result = parseResponse(response);

    expect(result.text).toBe('');
    expect(result.toolCalls).toEqual([]);
    expect(result.isComplete).toBe(false);
  });

  // 7. Tool calls are correctly preserved
  it('preserves tool call array correctly', () => {
    const toolCalls: ToolCallRequest[] = [
      makeToolCall('abc', 'tool_a', { key: 'value' }),
      makeToolCall('def', 'tool_b', { num: 42 }),
      makeToolCall('ghi', 'tool_c', { flag: true }),
    ];
    const response: AgentResponse = {
      content: 'Running tools...',
      toolCalls,
    };

    const result = parseResponse(response);

    expect(result.toolCalls).toHaveLength(3);
    expect(result.toolCalls[0].id).toBe('abc');
    expect(result.toolCalls[0].name).toBe('tool_a');
    expect(result.toolCalls[0].arguments).toEqual({ key: 'value' });
    expect(result.toolCalls[1].id).toBe('def');
    expect(result.toolCalls[1].name).toBe('tool_b');
    expect(result.toolCalls[1].arguments).toEqual({ num: 42 });
    expect(result.toolCalls[2].id).toBe('ghi');
    expect(result.toolCalls[2].name).toBe('tool_c');
    expect(result.toolCalls[2].arguments).toEqual({ flag: true });
  });

  // Edge: marker in the middle of text
  it('detects marker in the middle of content', () => {
    const response: AgentResponse = {
      content: 'Some text TASK_COMPLETE more text',
      toolCalls: [],
    };

    const result = parseResponse(response);

    expect(result.isComplete).toBe(true);
  });

  // Edge: whitespace-only content
  it('returns isComplete false for whitespace-only content with no tool calls', () => {
    const response: AgentResponse = {
      content: '   ',
      toolCalls: [],
    };

    const result = parseResponse(response);

    // Whitespace without a completion marker is NOT complete
    expect(result.isComplete).toBe(false);
  });
});