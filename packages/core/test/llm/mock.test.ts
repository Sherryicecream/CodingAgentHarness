import { describe, it, expect, vi } from 'vitest';
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

  it('hides feedback state from a selector while recording the full received context', async () => {
    const context = {
      messages: [{ role: 'system' as const, content: 'Structured feedback: {}' }],
      tools: [],
      memory: [],
      config: { maxIterations: 10, testCommand: '', allowedTools: [], blockedCommands: [], ignoredPaths: [] },
      feedbackState: {
        iteration: 1,
        lastResult: { status: 'fail' as const, failures: [], actionableFix: null },
      },
    };
    const selector = vi.fn((request) => {
      expect('feedbackState' in request).toBe(false);
      return makeResponse(request.messages[0]!.content);
    });
    const adapter = new MockLLMAdapter(selector);

    await expect(adapter.sendMessage(context)).resolves.toMatchObject({
      content: 'Structured feedback: {}',
    });
    expect(adapter.receivedContexts).toEqual([context]);
  });
});
