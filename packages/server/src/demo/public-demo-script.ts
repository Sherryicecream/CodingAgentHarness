import { MockLLMAdapter } from '../../../core/src/llm/mock.js';
import type { AgentResponse } from '../../../core/src/types.js';

export type PublicDemoStage =
  | 'initial_write'
  | 'dangerous_action_blocked'
  | 'corrected_write';

export interface ScriptedDemoCall {
  readonly callId: string;
  readonly stage: PublicDemoStage;
}

export const PUBLIC_DEMO_CALLS: readonly ScriptedDemoCall[] = Object.freeze([
  { callId: 'demo-initial-write', stage: 'initial_write' },
  { callId: 'demo-dangerous-write', stage: 'dangerous_action_blocked' },
  { callId: 'demo-corrected-write', stage: 'corrected_write' },
]);

const RESPONSES: readonly AgentResponse[] = Object.freeze([
  {
    content: 'Create the initial in-workspace implementation.',
    toolCalls: [{
      id: 'demo-initial-write',
      name: 'write_file',
      arguments: { path: 'demo.ts', content: "export const greeting = 'hello';\n" },
    }],
  },
  {
    content: 'Attempt a protected repository metadata write.',
    toolCalls: [{
      id: 'demo-dangerous-write',
      name: 'write_file',
      arguments: { path: '.git/config', content: 'unsafe' },
    }],
  },
  {
    content: 'Apply the structured validation feedback.',
    toolCalls: [{
      id: 'demo-corrected-write',
      name: 'write_file',
      arguments: {
        path: 'demo.ts',
        content: "export const greeting = 'hello, harness';\n",
      },
    }],
  },
]);

export const createPublicDemoAdapter = (): MockLLMAdapter => (
  new MockLLMAdapter(RESPONSES.map((response) => ({
    ...response,
    toolCalls: response.toolCalls.map((call) => ({
      ...call,
      arguments: { ...call.arguments },
    })),
  })))
);
