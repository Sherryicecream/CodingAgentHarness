import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type HarnessApp } from '../../src/app.js';
import type { CredentialStore } from '../../src/credential-store.js';
import { createWorkspaceManager, type WorkspaceManager } from '../../src/session/workspace-manager.js';
import type { SSEEvent, SSEManager } from '../../src/sse/sse-manager.js';

const temporaryRoots: string[] = [];
const apps: HarnessApp[] = [];

vi.mock('node:child_process', () => {
  const prohibited = (): never => { throw new Error('PROCESS_SENTINEL_CALLED'); };
  return { exec: prohibited, execFile: prohibited, spawn: prohibited, fork: prohibited };
});

const waitFor = async (predicate: () => boolean): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for demo completion');
};

const deferWorkspaceWrite = (
  manager: WorkspaceManager,
  deferredCall: number,
): {
  manager: WorkspaceManager;
  started: Promise<void>;
  aborted: Promise<void>;
  release(): void;
  committedWrites(): number;
} => {
  let calls = 0;
  let committedWrites = 0;
  let announceStarted!: () => void;
  const started = new Promise<void>((resolve) => { announceStarted = resolve; });
  let announceAborted!: () => void;
  const aborted = new Promise<void>((resolve) => { announceAborted = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return {
    started,
    aborted,
    release,
    committedWrites: () => committedWrites,
    manager: {
      create: (sessionId) => manager.create(sessionId),
      getIssuedPath: (sessionId) => manager.getIssuedPath(sessionId),
      assertIssued: (sessionId, path) => manager.assertIssued(sessionId, path),
      async writeIssuedFile(sessionId, filePath, content, signal) {
        calls += 1;
        if (calls === deferredCall) {
          announceStarted();
          if (signal?.aborted) {
            announceAborted();
          } else {
            signal?.addEventListener('abort', announceAborted, { once: true });
          }
          await gate;
        }
        if (signal?.aborted) throw new Error('DEFERRED_WRITE_ABORTED');
        await manager.writeIssuedFile(sessionId, filePath, content, signal);
        committedWrites += 1;
      },
      remove: (sessionId) => manager.remove(sessionId),
    },
  };
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => (
    rm(root, { recursive: true, force: true })
  )));
});

describe('public demo route', () => {
  it('runs over HTTP without a key or credential/provider access and rejects a demo key', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'harness-public-demo-route-'));
    temporaryRoots.push(workspaceRoot);
    const events: SSEEvent[] = [];
    const credentialAccess = vi.fn((): never => { throw new Error('CREDENTIAL_SENTINEL_CALLED'); });
    const credentialStore: CredentialStore = {
      hasKey: credentialAccess,
      getKey: credentialAccess,
      setKey: credentialAccess,
      deleteKey: credentialAccess,
      listServices: credentialAccess,
    };
    const sseManager: SSEManager = {
      createConnection: () => undefined,
      disconnect: () => undefined,
      setSecrets: () => undefined,
      clearSecrets: () => undefined,
      push: (_sessionId, event) => { events.push(event); },
      close: () => undefined,
    };
    vi.stubGlobal('fetch', (): never => { throw new Error('NETWORK_SENTINEL_CALLED'); });
    const app = createApp({
      mode: 'public',
      workspaceRoot,
      idGenerator: () => 'routed-demo',
      credentialStore,
      byokAdapterFactory: () => { throw new Error('BYOK_SENTINEL_CALLED'); },
      sseManager,
    });
    apps.push(app);

    const issued = await request(app).post('/api/agent/sessions').send({});
    const started = await request(app).post('/api/agent/run').send({
      sessionId: issued.body.sessionId,
      task: 'show the safety mechanisms',
      mode: 'demo',
    });
    await waitFor(() => events.some((event) => (
      event.type === 'complete' || event.type === 'error'
    )));
    const rejectedKey = await request(app).post('/api/agent/run').send({
      sessionId: issued.body.sessionId,
      task: 'show the safety mechanisms',
      mode: 'demo',
      apiKey: 'demo-must-not-accept-a-key',
    });

    expect(started.status).toBe(202);
    expect(events.map((event) => (event.data as { stage?: string }).stage).filter(Boolean))
      .toEqual([
        'initial_write',
        'dangerous_action_blocked',
        'validation_failed',
        'structured_feedback',
        'corrected_write',
        'validation_passed',
        'demo_complete',
      ]);
    const blocked = events.find((event) => (
      (event.data as { stage?: string }).stage === 'dangerous_action_blocked'
    ));
    expect(blocked).toEqual(expect.objectContaining({
      type: 'tool_call',
      data: expect.objectContaining({
        name: 'write_file',
        riskLevel: 'dangerous',
        status: 'failed',
        result: { success: false, output: '', error: 'BLOCKED_BY_GOVERNANCE' },
      }),
    }));
    expect(events.some((event) => event.type === 'guardrail')).toBe(false);
    await expect(readFile(join(workspaceRoot, 'routed-demo', 'demo.ts'), 'utf8'))
      .resolves.toBe("export const greeting = 'hello, harness';\n");
    expect(rejectedKey.status).toBe(400);
    expect(rejectedKey.body).toEqual({ error: 'INVALID_RUN_REQUEST' });
    expect(credentialAccess).not.toHaveBeenCalled();
  });

  it('expires through the shared lifecycle without demo events or writes after termination starts', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'harness-expired-demo-route-'));
    temporaryRoots.push(workspaceRoot);
    let currentTime = new Date('2026-08-08T00:00:00.000Z');
    let sweep: Promise<void> | undefined;
    const events: SSEEvent[] = [];
    let app!: HarnessApp;
    const sseManager: SSEManager = {
      createConnection: () => undefined,
      disconnect: () => undefined,
      setSecrets: () => undefined,
      clearSecrets: () => undefined,
      push: (_sessionId, event) => {
        events.push(event);
        if (
          event.type === 'loop_step'
          && (event.data as { phase?: string }).phase === 'starting'
          && !sweep
        ) {
          currentTime = new Date('2026-08-08T01:00:00.000Z');
          sweep = app.sweepSessions();
        }
      },
      close: () => undefined,
    };
    app = createApp({
      mode: 'public',
      workspaceRoot,
      now: () => new Date(currentTime),
      idGenerator: () => 'expiring-demo',
      sseManager,
      logger: {
        error: () => undefined,
        info: () => undefined,
        warn: () => undefined,
      },
    });
    apps.push(app);

    await request(app).post('/api/agent/sessions').send({});
    const started = await request(app).post('/api/agent/run').send({
      sessionId: 'expiring-demo',
      task: 'show the safety mechanisms',
      mode: 'demo',
    });
    await sweep;
    const eventCountAtCleanup = events.length;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(started.status).toBe(202);
    expect(events.filter((event) => (event.data as { stage?: string }).stage)).toEqual([]);
    expect(events).toHaveLength(eventCountAtCleanup);
    await expect(readFile(join(workspaceRoot, 'expiring-demo', 'demo.ts'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    { label: 'initial', deferredCall: 1, committedBeforeExpiry: 0 },
    { label: 'corrected', deferredCall: 2, committedBeforeExpiry: 1 },
  ])(
    'expires during an in-flight $label write without committing or emitting late stages',
    async ({ deferredCall, committedBeforeExpiry }) => {
      const workspaceRoot = await mkdtemp(join(tmpdir(), 'harness-inflight-expiry-'));
      temporaryRoots.push(workspaceRoot);
      const actualManager = createWorkspaceManager({ root: workspaceRoot });
      const deferred = deferWorkspaceWrite(actualManager, deferredCall);
      let currentTime = new Date('2026-08-08T00:00:00.000Z');
      const events: SSEEvent[] = [];
      const sseManager: SSEManager = {
        createConnection: () => undefined,
        disconnect: () => undefined,
        setSecrets: () => undefined,
        clearSecrets: () => undefined,
        push: (_sessionId, event) => { events.push(event); },
        close: () => undefined,
      };
      const app = createApp({
        mode: 'public',
        workspaceRoot,
        workspaceManager: deferred.manager,
        now: () => new Date(currentTime),
        idGenerator: () => `inflight-${deferredCall}`,
        sseManager,
        logger: {
          error: () => undefined,
          info: () => undefined,
          warn: () => undefined,
        },
      });
      apps.push(app);
      await request(app).post('/api/agent/sessions').send({});
      const response = await request(app).post('/api/agent/run').send({
        sessionId: `inflight-${deferredCall}`,
        task: 'show the safety mechanisms',
        mode: 'demo',
      });
      await deferred.started;

      currentTime = new Date('2026-08-08T01:00:00.000Z');
      const sweep = app.sweepSessions();
      await deferred.aborted;
      deferred.release();
      await sweep;
      const eventCountAtCleanup = events.length;
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(response.status).toBe(202);
      expect(deferred.committedWrites()).toBe(committedBeforeExpiry);
      expect(events.some((event) => (
        (event.data as { stage?: string }).stage === 'corrected_write'
      ))).toBe(false);
      expect(events).toHaveLength(eventCountAtCleanup);
      await expect(readFile(join(workspaceRoot, `inflight-${deferredCall}`, 'demo.ts'), 'utf8'))
        .rejects.toMatchObject({ code: 'ENOENT' });
    },
  );
});
