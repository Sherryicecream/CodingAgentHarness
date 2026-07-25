import { LLMAdapter } from './adapter.js';
import { AgentContext, AgentResponse, ToolCallRequest } from '../types.js';

export class LLMCallError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseBody?: string,
  ) {
    super(message);
    this.name = 'LLMCallError';
  }
}

export class DeepSeekAdapter implements LLMAdapter {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(options: { apiKey: string; model?: string; baseUrl?: string }) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'deepseek-chat';
    this.baseUrl = options.baseUrl ?? 'https://api.deepseek.com';
  }

  async sendMessage(context: AgentContext): Promise<AgentResponse> {
    // Build OpenAI-compatible request body
    const body = {
      model: this.model,
      messages: context.messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.name ? { name: m.name } : {}),
      })),
      tools: context.tools.length > 0 ? context.tools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })) : undefined,
    };

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new LLMCallError(
        `DeepSeek API error: ${response.status} ${response.statusText}`,
        response.status,
        text,
      );
    }

    const data = await response.json() as any;
    const choice = data.choices?.[0];
    const message = choice?.message;

    // Parse tool calls if present
    const toolCalls: ToolCallRequest[] = (message?.tool_calls ?? []).map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    return {
      content: message?.content ?? '',
      toolCalls,
    };
  }
}