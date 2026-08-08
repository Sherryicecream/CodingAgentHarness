import { AgentContext, AgentResponse } from '../types.js';

/**
 * LLMAdapter is the single point of contact between the harness and any LLM.
 * All harness mechanisms call this interface — never a specific LLM directly.
 * This enables mock testing: inject MockLLMAdapter and the entire harness
 * runs deterministically without network calls.
 */
export interface LLMAdapter {
  sendMessage(context: AgentContext, signal?: AbortSignal): Promise<AgentResponse>;
}
