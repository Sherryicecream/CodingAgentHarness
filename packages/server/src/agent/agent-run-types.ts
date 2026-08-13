import type { LLMAdapter } from '../../../core/src/llm/adapter.js';
import type { Session } from '../../../core/src/types.js';
import type { RuntimeExperience } from '../security/runtime-policy.js';
import type { PublicSession } from '../session/session-registry.js';
import type { SSEEvent } from '../sse/sse-manager.js';

export interface AgentRunInput {
  readonly session: PublicSession;
  readonly task: string;
  readonly mode: RuntimeExperience;
  readonly providerId?: string;
  readonly apiKey?: string;
  readonly emit: (type: SSEEvent['type'], data: unknown) => void;
}

export interface AgentRunOutput {
  readonly status: string;
  readonly sessionId?: string;
  readonly session?: Session;
  readonly completionData?: Readonly<Record<string, unknown>>;
}

export interface AgentRunHandle {
  readonly completion: Promise<AgentRunOutput | void>;
  continueAfterApproval?(): Promise<AgentRunOutput | void>;
  approve?(approved: boolean): void;
  abort?(): void | Promise<void>;
  release?(): void;
}

export type AgentRun = (
  input: AgentRunInput,
) => Promise<AgentRunOutput | void> | AgentRunHandle;

export interface ByokAdapterResource {
  readonly adapter: LLMAdapter;
  release?(): void;
}

export type ByokAdapterFactory = (apiKey: string) => ByokAdapterResource;

export const toRunHandle = (
  started: Promise<AgentRunOutput | void> | AgentRunHandle,
): AgentRunHandle => ('completion' in started ? started : { completion: started });
