import type { CredentialStore } from '../credential-store.js';
import { createPublicDemoRunner } from '../demo/public-demo-runner.js';
import type { RuntimePolicy } from '../security/runtime-policy.js';
import type { WorkspaceManager } from '../session/workspace-manager.js';
import {
  toRunHandle,
  type AgentRun,
  type AgentRunHandle,
  type ByokAdapterFactory,
} from './agent-run-types.js';
import type { PrivilegedAgentRunOptions } from './privileged-agent-run.js';

interface PrivilegedAgentRunModule {
  createPrivilegedAgentRun(options: PrivilegedAgentRunOptions): AgentRun;
}

export type PrivilegedAgentRunLoader = () => Promise<PrivilegedAgentRunModule>;

export interface DefaultAgentRunOptions extends PrivilegedAgentRunOptions {
  readonly policy: RuntimePolicy;
  readonly credentialStore: CredentialStore;
  readonly byokAdapterFactory?: ByokAdapterFactory;
  readonly workspaceManager?: WorkspaceManager;
  readonly now?: () => Date;
  readonly privilegedLoader?: PrivilegedAgentRunLoader;
}

class AgentRunCancelledBeforeLoadError extends Error {
  constructor() {
    super('AGENT_RUN_CANCELLED_BEFORE_LOAD');
    this.name = 'AgentRunCancelledBeforeLoadError';
  }
}

const loadPrivilegedAgentRun: PrivilegedAgentRunLoader = () => (
  import('./privileged-agent-run.js')
);

const createLazyPrivilegedHandle = (
  options: DefaultAgentRunOptions,
  input: Parameters<AgentRun>[0],
): AgentRunHandle => {
  let inner: AgentRunHandle | undefined;
  let abortRequested = false;
  let released = false;
  const pendingApprovals: boolean[] = [];
  const ready = (options.privilegedLoader ?? loadPrivilegedAgentRun)().then((module) => {
    if (abortRequested || released) throw new AgentRunCancelledBeforeLoadError();
    inner = toRunHandle(module.createPrivilegedAgentRun(options)(input));
    for (const approved of pendingApprovals.splice(0)) inner.approve?.(approved);
    return inner;
  });
  const completion = ready.then((handle) => handle.completion);

  return {
    completion,
    continueAfterApproval: async () => {
      const handle = await ready;
      if (!handle.continueAfterApproval) {
        throw new Error('APPROVAL_CONTINUATION_UNAVAILABLE');
      }
      return handle.continueAfterApproval();
    },
    approve: (approved) => {
      if (inner) {
        inner.approve?.(approved);
      } else {
        pendingApprovals.push(approved);
      }
    },
    abort: async () => {
      abortRequested = true;
      try {
        const handle = await ready;
        await handle.abort?.();
      } catch (error) {
        if (!(error instanceof AgentRunCancelledBeforeLoadError)) throw error;
      }
    },
    release: () => {
      released = true;
      pendingApprovals.length = 0;
      inner?.release?.();
    },
  };
};

export const createDefaultAgentRun = (
  options: DefaultAgentRunOptions,
): AgentRun => (input) => {
  if (input.mode !== 'demo') return createLazyPrivilegedHandle(options, input);
  if (!options.workspaceManager) {
    throw new Error('Public demo workspace manager is unavailable');
  }
  const runner = createPublicDemoRunner({
    emit: input.emit,
    workspaceManager: options.workspaceManager,
    now: options.now,
    emitComplete: false,
  });
  const abortController = new AbortController();
  const completion = runner.run(input.session, abortController.signal).then((result) => ({
    ...result,
    completionData: { stage: 'demo_complete' },
  }));
  return {
    completion,
    abort: async () => {
      abortController.abort();
      await completion.catch(() => undefined);
    },
    release: () => { abortController.abort(); },
  };
};
