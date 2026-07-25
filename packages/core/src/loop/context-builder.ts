import { AgentContext, AgentConfig, FeedbackState, Message, ToolDefinition, MemoryEntry } from '../types.js';

export interface ContextBuilder {
  build(options: {
    task: string;
    messages: Message[];
    tools: ToolDefinition[];
    memories: MemoryEntry[];
    config: AgentConfig;
    feedbackState: FeedbackState | null;
  }): AgentContext;
}

export function createContextBuilder(systemPrompt?: string): ContextBuilder {
  const defaultSystemPrompt =
    'You are a coding agent. You can read/write files, execute shell commands, run tests, and search code. Use tools to complete the user\'s task. When the task is complete and all tests pass, include "TASK_COMPLETE" in your response.';

  return {
    build(options) {
      const systemMsg: Message = {
        role: 'system',
        content: systemPrompt ?? defaultSystemPrompt,
      };

      const messages: Message[] = [systemMsg];

      // Inject memories as context
      if (options.memories.length > 0) {
        messages.push({
          role: 'system',
          content:
            'Relevant project knowledge:\n' +
            options.memories.map(m => `- [${m.type}] ${m.content}`).join('\n'),
        });
      }

      // Inject feedback state
      if (options.feedbackState) {
        messages.push({
          role: 'system',
          content: `Previous test run failed (iteration ${options.feedbackState.iteration}). Please fix the code.`,
        });
      }

      // Add conversation history + current task
      messages.push(...options.messages);
      messages.push({ role: 'user', content: options.task });

      return {
        messages,
        tools: options.tools,
        memory: options.memories,
        config: options.config,
        feedbackState: options.feedbackState,
      };
    },
  };
}