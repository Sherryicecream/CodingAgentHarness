import { LLMAdapter } from './adapter.js';
import { AgentContext, AgentResponse } from '../types.js';

export type MockLLMSelectorContext = Omit<AgentContext, 'feedbackState'>;

export type MockLLMResponseSelector = (
  context: MockLLMSelectorContext,
) => AgentResponse | undefined;

export class MockLLMExhaustedError extends Error {
  constructor() {
    super('MockLLMAdapter: no more responses available');
    this.name = 'MockLLMExhaustedError';
  }
}

export class MockLLMAdapter implements LLMAdapter {
  private index = 0;
  readonly receivedContexts: AgentContext[] = [];

  constructor(private responses: AgentResponse[] | MockLLMResponseSelector) {}

  async sendMessage(context: AgentContext): Promise<AgentResponse> {
    this.receivedContexts.push(context);
    if (typeof this.responses === 'function') {
      const { feedbackState: _feedbackState, ...selectorContext } = context;
      const response = this.responses(selectorContext);
      if (!response) throw new MockLLMExhaustedError();
      return response;
    }
    if (this.index >= this.responses.length) {
      throw new MockLLMExhaustedError();
    }
    return this.responses[this.index++];
  }

  /** Returns the number of remaining unconsumed responses */
  get remainingCount(): number {
    return Array.isArray(this.responses) ? this.responses.length - this.index : 0;
  }
}
