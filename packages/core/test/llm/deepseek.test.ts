import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { DeepSeekAdapter, LLMCallError } from '../../src/llm/deepseek.js';
import { AgentContext } from '../../src/types.js';

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    messages: [
      { role: 'user', content: 'Hello!' },
    ],
    tools: [],
    memory: [],
    config: {
      maxIterations: 10,
      testCommand: '',
      allowedTools: [],
      blockedCommands: [],
      ignoredPaths: [],
    },
    feedbackState: null,
    ...overrides,
  };
}

describe('DeepSeekAdapter', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('default model is deepseek-chat', () => {
    const adapter = new DeepSeekAdapter({ apiKey: 'test-key' });
    // We verify the default by checking that a nock for the default URL works
    // and that the request body includes the default model
    const scope = nock('https://api.deepseek.com')
      .post('/v1/chat/completions', (body) => {
        expect(body.model).toBe('deepseek-chat');
        return true;
      })
      .reply(200, {
        choices: [{ message: { content: 'Hello from DeepSeek!' } }],
      });

    return adapter.sendMessage(makeContext()).then((res) => {
      expect(res.content).toBe('Hello from DeepSeek!');
      scope.done();
    });
  });

  it('custom model and baseUrl are respected', async () => {
    const adapter = new DeepSeekAdapter({
      apiKey: 'test-key',
      model: 'deepseek-reasoner',
      baseUrl: 'https://custom.deepseek.example.com',
    });

    const scope = nock('https://custom.deepseek.example.com')
      .post('/v1/chat/completions', (body) => {
        expect(body.model).toBe('deepseek-reasoner');
        return true;
      })
      .reply(200, {
        choices: [{ message: { content: 'Custom model response' } }],
      });

    const res = await adapter.sendMessage(makeContext());
    expect(res.content).toBe('Custom model response');
    scope.done();
  });

  it('sends correct API request structure', async () => {
    const adapter = new DeepSeekAdapter({ apiKey: 'test-key' });

    const context = makeContext({
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is TypeScript?' },
      ],
    });

    const scope = nock('https://api.deepseek.com')
      .post('/v1/chat/completions', (body) => {
        // Verify body structure
        expect(body.model).toBe('deepseek-chat');
        expect(body.messages).toHaveLength(2);
        expect(body.messages[0]).toEqual({
          role: 'system',
          content: 'You are a helpful assistant.',
        });
        expect(body.messages[1]).toEqual({
          role: 'user',
          content: 'What is TypeScript?',
        });
        expect(body.tools).toBeUndefined();
        return true;
      })
      .reply(200, {
        choices: [{ message: { content: 'TypeScript is a typed superset of JavaScript.' } }],
      });

    const res = await adapter.sendMessage(context);
    expect(res.content).toBe('TypeScript is a typed superset of JavaScript.');
    scope.done();
  });

  it('sends correct headers and method', async () => {
    const adapter = new DeepSeekAdapter({ apiKey: 'my-secret-key' });

    const scope = nock('https://api.deepseek.com', {
      reqheaders: {
        'content-type': 'application/json',
        'authorization': 'Bearer my-secret-key',
      },
    })
      .post('/v1/chat/completions')
      .reply(200, {
        choices: [{ message: { content: 'ok' } }],
      });

    const res = await adapter.sendMessage(makeContext());
    expect(res.content).toBe('ok');
    scope.done();
  });

  it('parses response with tool calls', async () => {
    const adapter = new DeepSeekAdapter({ apiKey: 'test-key' });

    const context = makeContext({
      messages: [
        { role: 'user', content: 'What is the weather in London?' },
      ],
      tools: [
        {
          name: 'get_weather',
          description: 'Get the current weather for a city',
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string', description: 'The city name' },
            },
            required: ['city'],
          },
        },
      ],
    });

    const scope = nock('https://api.deepseek.com')
      .post('/v1/chat/completions', (body) => {
        expect(body.tools).toHaveLength(1);
        expect(body.tools[0].type).toBe('function');
        expect(body.tools[0].function.name).toBe('get_weather');
        return true;
      })
      .reply(200, {
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"city":"London"}',
                  },
                },
              ],
            },
          },
        ],
      });

    const res = await adapter.sendMessage(context);
    expect(res.content).toBe('');
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].id).toBe('call_abc123');
    expect(res.toolCalls[0].name).toBe('get_weather');
    expect(res.toolCalls[0].arguments).toEqual({ city: 'London' });
    scope.done();
  });

  it('throws LLMCallError on API error (non-200 status)', async () => {
    const adapter = new DeepSeekAdapter({ apiKey: 'test-key' });

    const scope = nock('https://api.deepseek.com')
      .post('/v1/chat/completions')
      .reply(401, {
        error: {
          message: 'Invalid API key',
          type: 'authentication_error',
        },
      });

    try {
      await adapter.sendMessage(makeContext());
      // Should not reach here
      expect.fail('Expected LLMCallError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LLMCallError);
      const llmError = err as LLMCallError;
      expect(llmError.statusCode).toBe(401);
      expect(llmError.responseBody).toBeTruthy();
    }

    scope.done();
  });

  it('throws LLMCallError on 500 server error', async () => {
    const adapter = new DeepSeekAdapter({ apiKey: 'test-key' });

    const scope = nock('https://api.deepseek.com')
      .post('/v1/chat/completions')
      .reply(500, {
        error: {
          message: 'Internal server error',
          type: 'server_error',
        },
      });

    try {
      await adapter.sendMessage(makeContext());
      // Should not reach here
      expect.fail('Expected LLMCallError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LLMCallError);
      const llmError = err as LLMCallError;
      expect(llmError.statusCode).toBe(500);
      expect(llmError.message).toContain('500');
    }

    scope.done();
  });

  it('handles empty response content gracefully', async () => {
    const adapter = new DeepSeekAdapter({ apiKey: 'test-key' });

    const scope = nock('https://api.deepseek.com')
      .post('/v1/chat/completions')
      .reply(200, {
        choices: [{ message: { content: null } }],
      });

    const res = await adapter.sendMessage(makeContext());
    expect(res.content).toBe('');
    expect(res.toolCalls).toEqual([]);
    scope.done();
  });

  it('handles missing choices array gracefully', async () => {
    const adapter = new DeepSeekAdapter({ apiKey: 'test-key' });

    const scope = nock('https://api.deepseek.com')
      .post('/v1/chat/completions')
      .reply(200, {});

    const res = await adapter.sendMessage(makeContext());
    expect(res.content).toBe('');
    expect(res.toolCalls).toEqual([]);
    scope.done();
  });
});