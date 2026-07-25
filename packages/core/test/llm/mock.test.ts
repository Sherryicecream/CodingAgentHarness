import { describe, it, expect } from 'vitest';
import { MockLLMAdapter, MockLLMExhaustedError } from '../../src/llm/mock.js';
import { AgentResponse } from '../../src/types.js';

function makeResponse(content: string): AgentResponse {
  return { content, toolCalls: [] };
}

describe('MockLLMAdapter', () => {
  it('returns responses in FIFO order', async () => {
    const responses = [
      makeResponse('first'),
      makeResponse('second'),
      makeResponse('third'),
    ];
    const adapter = new MockLLMAdapter(responses);

    const r1 = await adapter.sendMessage({
      messages: [],
      tools: [],
      memory: [],
      config: { maxIterations: 10, testCommand: '', allowedTools: [], blockedCommands: [], ignoredPaths: [] },
      feedbackState: null,
    });
    const r2 = await adapter.sendMessage({
      messages: [],
      tools: [],
      memory: [],
      config: { maxIterations: 10, testCommand: '', allowedTools: [], blockedCommands: [], ignoredPaths: [] },
      feedbackState: null,
    });
    const r3 = await adapter.sendMessage({
      messages: [],
      tools: [],
      memory: [],
      config: { maxIterations: 10, testCommand: '', allowedTools: [], blockedCommands: [], ignoredPaths: [] },
      feedbackState: null,
    });

    expect(r1.content).toBe('first');
    expect(r2.content).toBe('second');
    expect(r3.content).toBe('third');
  });

  it('third call returns third response', async () => {
    const responses = [
      makeResponse('one'),
      makeResponse('two'),
      makeResponse('three'),
    ];
    const adapter = new MockLLMAdapter(responses);

    await adapter.sendMessage({
      messages: [],
      tools: [],
      memory: [],
      config: { maxIterations: 10, testCommand: '', allowedTools: [], blockedCommands: [], ignoredPaths: [] },
      feedbackState: null,
    });
    await adapter.sendMessage({
      messages: [],
      tools: [],
      memory: [],
      config: { maxIterations: 10, testCommand: '', allowedTools: [], blockedCommands: [], ignoredPaths: [] },
      feedbackState: null,
    });
    const r3 = await adapter.sendMessage({
      messages: [],
      tools: [],
      memory: [],
      config: { maxIterations: 10, testCommand: '', allowedTools: [], blockedCommands: [], ignoredPaths: [] },
      feedbackState: null,
    });

    expect(r3.content).toBe('three');
  });

  it('throws MockLLMExhaustedError when exhausted', async () => {
    const adapter = new MockLLMAdapter([makeResponse('only')]);

    await adapter.sendMessage({
      messages: [],
      tools: [],
      memory: [],
      config: { maxIterations: 10, testCommand: '', allowedTools: [], blockedCommands: [], ignoredPaths: [] },
      feedbackState: null,
    });

    await expect(
      adapter.sendMessage({
        messages: [],
        tools: [],
        memory: [],
        config: { maxIterations: 10, testCommand: '', allowedTools: [], blockedCommands: [], ignoredPaths: [] },
        feedbackState: null,
      })
    ).rejects.toThrow(MockLLMExhaustedError);
  });

  it('remainingCount starts at array length and decrements after each call', async () => {
    const responses = [makeResponse('a'), makeResponse('b'), makeResponse('c')];
    const adapter = new MockLLMAdapter(responses);

    expect(adapter.remainingCount).toBe(3);

    await adapter.sendMessage({
      messages: [],
      tools: [],
      memory: [],
      config: { maxIterations: 10, testCommand: '', allowedTools: [], blockedCommands: [], ignoredPaths: [] },
      feedbackState: null,
    });
    expect(adapter.remainingCount).toBe(2);

    await adapter.sendMessage({
      messages: [],
      tools: [],
      memory: [],
      config: { maxIterations: 10, testCommand: '', allowedTools: [], blockedCommands: [], ignoredPaths: [] },
      feedbackState: null,
    });
    expect(adapter.remainingCount).toBe(1);

    await adapter.sendMessage({
      messages: [],
      tools: [],
      memory: [],
      config: { maxIterations: 10, testCommand: '', allowedTools: [], blockedCommands: [], ignoredPaths: [] },
      feedbackState: null,
    });
    expect(adapter.remainingCount).toBe(0);
  });
});