import { describe, it, expect } from 'vitest';
import { createContextBuilder, ContextBuilder } from '../../src/loop/context-builder.js';
import { AgentConfig, FeedbackState, Message, ToolDefinition, MemoryEntry } from '../../src/types.js';

describe('ContextBuilder', () => {
  const defaultConfig: AgentConfig = {
    maxIterations: 20,
    testCommand: 'npm test',
    allowedTools: ['*'],
    blockedCommands: ['rm -rf'],
    ignoredPaths: ['node_modules'],
  };

  const sampleTools: ToolDefinition[] = [
    { name: 'read_file', description: 'Read a file', parameters: {} },
    { name: 'write_file', description: 'Write a file', parameters: {} },
  ];

  const sampleMessages: Message[] = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi! How can I help?' },
  ];

  const sampleMemories: MemoryEntry[] = [
    {
      id: 'm1',
      type: 'convention',
      content: 'Use 2-space indentation',
      source: 'code-review',
      createdAt: new Date('2024-01-01'),
      lastAccessedAt: new Date('2024-01-01'),
    },
    {
      id: 'm2',
      type: 'decision',
      content: 'Use TypeScript strict mode',
      source: 'team-meeting',
      createdAt: new Date('2024-01-02'),
      lastAccessedAt: new Date('2024-01-02'),
    },
  ];

  describe('build', () => {
    it('should build basic context with system + user messages', () => {
      const builder = createContextBuilder();
      const context = builder.build({
        task: 'Fix the bug',
        messages: [],
        tools: sampleTools,
        memories: [],
        config: defaultConfig,
        feedbackState: null,
      });

      expect(context.messages.length).toBeGreaterThanOrEqual(2);
      expect(context.messages[0].role).toBe('system');
      expect(context.messages[context.messages.length - 1].role).toBe('user');
      expect(context.messages[context.messages.length - 1].content).toBe('Fix the bug');
    });

    it('should inject memories into context when present', () => {
      const builder = createContextBuilder();
      const context = builder.build({
        task: 'Fix the bug',
        messages: [],
        tools: sampleTools,
        memories: sampleMemories,
        config: defaultConfig,
        feedbackState: null,
      });

      // Find the memory context message
      const memoryMsg = context.messages.find(m =>
        m.role === 'system' && m.content.includes('Relevant project knowledge')
      );
      expect(memoryMsg).toBeDefined();
      expect(memoryMsg!.content).toContain('[convention] Use 2-space indentation');
      expect(memoryMsg!.content).toContain('[decision] Use TypeScript strict mode');
    });

    it('should inject feedback state when present', () => {
      const builder = createContextBuilder();
      const feedbackState: FeedbackState = {
        iteration: 3,
        lastResult: {
          status: 'fail',
          failures: [],
          actionableFix: null,
        },
      };

      const context = builder.build({
        task: 'Fix the bug',
        messages: [],
        tools: sampleTools,
        memories: [],
        config: defaultConfig,
        feedbackState,
      });

      const feedbackMsg = context.messages.find(m =>
        m.role === 'system' && m.content.includes('Previous test run failed')
      );
      expect(feedbackMsg).toBeDefined();
      expect(feedbackMsg!.content).toContain('iteration 3');
    });

    it('should pass tools correctly to the context', () => {
      const builder = createContextBuilder();
      const context = builder.build({
        task: 'Fix the bug',
        messages: [],
        tools: sampleTools,
        memories: [],
        config: defaultConfig,
        feedbackState: null,
      });

      expect(context.tools).toEqual(sampleTools);
      expect(context.tools).toHaveLength(2);
      expect(context.tools[0].name).toBe('read_file');
    });

    it('should pass config correctly to the context', () => {
      const builder = createContextBuilder();
      const context = builder.build({
        task: 'Fix the bug',
        messages: [],
        tools: sampleTools,
        memories: [],
        config: defaultConfig,
        feedbackState: null,
      });

      expect(context.config).toEqual(defaultConfig);
      expect(context.config.maxIterations).toBe(20);
      expect(context.config.testCommand).toBe('npm test');
    });

    it('should include conversation history in the context', () => {
      const builder = createContextBuilder();
      const context = builder.build({
        task: 'Continue working',
        messages: sampleMessages,
        tools: sampleTools,
        memories: [],
        config: defaultConfig,
        feedbackState: null,
      });

      // Verify conversation history is in the messages
      const userMsg = context.messages.find(m => m.role === 'user' && m.content === 'Hello');
      const assistantMsg = context.messages.find(m => m.role === 'assistant' && m.content === 'Hi! How can I help?');
      expect(userMsg).toBeDefined();
      expect(assistantMsg).toBeDefined();
    });

    it('should use custom system prompt when provided', () => {
      const customPrompt = 'You are a specialized testing agent.';
      const builder = createContextBuilder(customPrompt);
      const context = builder.build({
        task: 'Run tests',
        messages: [],
        tools: sampleTools,
        memories: [],
        config: defaultConfig,
        feedbackState: null,
      });

      expect(context.messages[0].role).toBe('system');
      expect(context.messages[0].content).toBe(customPrompt);
    });
  });
});