import { describe, it, expect } from 'vitest';
import { LLMAdapter } from '../../src/llm/adapter.js';
import { AgentContext, AgentResponse } from '../../src/types.js';

describe('LLMAdapter interface', () => {
  it('should be implementable by a mock', () => {
    // Type-level test: verify the interface can be implemented
    const mock: LLMAdapter = {
      sendMessage: async (_ctx: AgentContext): Promise<AgentResponse> => ({
        content: 'test response',
        toolCalls: [],
      }),
    };
    expect(typeof mock.sendMessage).toBe('function');
  });

  it('should accept a minimal AgentContext', async () => {
    const mock: LLMAdapter = {
      sendMessage: async (_ctx: AgentContext): Promise<AgentResponse> => ({
        content: 'ok',
        toolCalls: [],
      }),
    };

    const context: AgentContext = {
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      memory: [],
      config: {
        maxIterations: 20,
        testCommand: 'npm test',
        allowedTools: ['*'],
        blockedCommands: [],
        ignoredPaths: [],
      },
      feedbackState: null,
    };

    const response = await mock.sendMessage(context);
    expect(response.content).toBe('ok');
    expect(response.toolCalls).toEqual([]);
  });
});