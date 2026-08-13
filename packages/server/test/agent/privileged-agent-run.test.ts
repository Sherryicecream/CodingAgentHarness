import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createPrivilegedAgentRun } from '../../src/agent/privileged-agent-run.js';
import type { CredentialStore } from '../../src/credential-store.js';
import { PUBLIC_RUNTIME_POLICY } from '../../src/security/runtime-policy.js';

const workspaces: string[] = [];

const credentialStore: CredentialStore = {
  status: () => ({ storage: 'keyring', hasKey: false }),
  getKey: () => null,
  setKey: () => undefined,
  deleteKey: () => false,
};

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

describe('privileged agent run memory integration', () => {
  it('starts an AgentLoop with a project-scoped memory store', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-agent-memory-'));
    workspaces.push(workspace);
    const run = createPrivilegedAgentRun({
      policy: PUBLIC_RUNTIME_POLICY,
      credentialStore,
      byokAdapterFactory: () => ({
        adapter: {
          async sendMessage() {
            return { content: 'TASK_COMPLETE', toolCalls: [] };
          },
        },
      }),
    });

    const agentRun = run({
      session: {
        id: 'memory-session',
        clientKey: 'client',
        workspace,
        retention: 'temporary',
        status: 'running',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
      task: 'Use project memory',
      mode: 'byok',
      apiKey: 'test-key',
      emit: () => undefined,
    });

    const handle = 'completion' in agentRun ? agentRun : { completion: agentRun };
    await expect(handle.completion).resolves.toMatchObject({ status: 'completed' });
  });
});
