import { LLMAdapter } from './adapter.js';
import { AgentContext, AgentResponse } from '../types.js';

export class MockLLMExhaustedError extends Error {
  constructor() {
    super('MockLLMAdapter: no more responses available');
    this.name = 'MockLLMExhaustedError';
  }
}

export class MockLLMAdapter implements LLMAdapter {
  private index = 0;

  constructor(private responses: AgentResponse[]) {}

  async sendMessage(_context: AgentContext): Promise<AgentResponse> {
    if (this.index >= this.responses.length) {
      throw new MockLLMExhaustedError();
    }
    return this.responses[this.index++];
  }

  /** Returns the number of remaining unconsumed responses */
  get remainingCount(): number {
    return this.responses.length - this.index;
  }
}