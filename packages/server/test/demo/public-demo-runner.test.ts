import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPublicDemoRunner } from '../../src/demo/public-demo-runner.js';
import type { PublicSession } from '../../src/session/session-registry.js';
import { createWorkspaceManager } from '../../src/session/workspace-manager.js';
import type { WorkspaceManager } from '../../src/session/workspace-manager.js';
import type { SSEEvent } from '../../src/sse/sse-manager.js';

const temporaryRoots: string[] = [];

vi.mock('node:child_process', () => {
  const prohibited = (): never => { throw new Error('PROCESS_SENTINEL_CALLED'); };
  return { exec: prohibited, execFile: prohibited, spawn: prohibited, fork: prohibited };
});

const createDemoSession = async (id: string): Promise<{
  session: PublicSession;
  workspaceManager: ReturnType<typeof createWorkspaceManager>;
}> => {
  const root = await mkdtemp(join(tmpdir(), 'harness-public-demo-'));
  temporaryRoots.push(root);
  const workspaceManager = createWorkspaceManager({ root });
  const workspace = await workspaceManager.create(id);
  return {
    workspaceManager,
    session: {
      id,
      clientKey: 'demo-client',
      workspace,
      status: 'running',
      createdAt: new Date('2026-08-08T00:00:00.000Z'),
      expiresAt: new Date('2026-08-08T01:00:00.000Z'),
    },
  };
};

const deferWriteCall = (
  manager: WorkspaceManager,
  deferredCall: number,
): {
  manager: WorkspaceManager;
  started: Promise<void>;
  release(): void;
  committedWrites(): number;
} => {
  let callCount = 0;
  let committedWrites = 0;
  let announceStarted!: () => void;
  const started = new Promise<void>((resolve) => { announceStarted = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return {
    started,
    release,
    committedWrites: () => committedWrites,
    manager: {
      create: (sessionId) => manager.create(sessionId),
      getIssuedPath: (sessionId) => manager.getIssuedPath(sessionId),
      assertIssued: (sessionId, path) => manager.assertIssued(sessionId, path),
      async writeIssuedFile(sessionId, filePath, content, signal) {
        callCount += 1;
        if (callCount === deferredCall) {
          announceStarted();
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
  await Promise.all(temporaryRoots.splice(0).map((root) => (
    rm(root, { recursive: true, force: true })
  )));
});

describe('public demo runner', () => {
  it('demonstrates governance and feedback in order and leaves the corrected file', async () => {
    const { session, workspaceManager } = await createDemoSession('ordered-demo');
    const events: Array<Pick<SSEEvent, 'type' | 'data'>> = [];
    const dangerousExecutor = vi.fn(async () => ({
      success: true,
      output: 'must never execute',
    }));
    const runner = createPublicDemoRunner({
      emit: (type, data) => { events.push({ type, data }); },
      workspaceManager,
      now: () => new Date('2026-08-08T00:00:00.000Z'),
      dangerousExecutor,
    });

    const result = await runner.run(session);

    expect(events.map((event) => ({
      type: event.type,
      stage: (event.data as { stage?: string }).stage,
    }))).toEqual([
      { type: 'tool_call', stage: 'initial_write' },
      { type: 'tool_call', stage: 'dangerous_action_blocked' },
      { type: 'loop_step', stage: 'validation_failed' },
      { type: 'feedback', stage: 'structured_feedback' },
      { type: 'tool_call', stage: 'corrected_write' },
      { type: 'feedback', stage: 'validation_passed' },
      { type: 'complete', stage: 'demo_complete' },
    ]);
    expect(events[1]?.data).toEqual(expect.objectContaining({
      name: 'write_file',
      riskLevel: 'dangerous',
      status: 'failed',
      result: { success: false, output: '', error: 'BLOCKED_BY_GOVERNANCE' },
    }));
    expect(events[0]?.data).toEqual(expect.objectContaining({
      name: 'write_file',
      context: { messageCount: 1, toolNames: ['write_file'] },
      dispatch: 'registry',
    }));
    expect(events[3]?.data).toEqual(expect.objectContaining({
      status: 'fail',
      actionableFix: expect.objectContaining({
        summary: '1 test failure(s) detected.',
      }),
    }));
    expect(result).toEqual({ status: 'completed', sessionId: 'ordered-demo' });
    expect(dangerousExecutor).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'guardrail')).toBe(false);
    await expect(readFile(join(session.workspace, 'demo.ts'), 'utf8'))
      .resolves.toBe("export const greeting = 'hello, harness';\n");
  });

  it('rejects a forged session workspace that does not match the manager-issued path', async () => {
    const { session, workspaceManager } = await createDemoSession('issued-demo');
    const outside = await mkdtemp(join(tmpdir(), 'harness-forged-demo-'));
    temporaryRoots.push(outside);
    const forged = { ...session, workspace: outside };
    const runner = createPublicDemoRunner({ emit: () => undefined, workspaceManager });

    await expect(runner.run(forged)).rejects.toThrow(/issued|workspace|mismatch/i);
    await expect(readFile(join(outside, 'demo.ts'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('has a runtime dependency graph with no process or network capability', async () => {
    const entry = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/demo/public-demo-runner.ts');
    const visited = new Set<string>();
    const violations: string[] = [];
    const inspect = async (file: string): Promise<void> => {
      if (visited.has(file)) return;
      visited.add(file);
      const source = await readFile(file, 'utf8');
      const runtimeImports = [...source.matchAll(
        /import\s+(?!type\b)([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
      )];
      for (const match of runtimeImports) {
        const specifier = match[2]!;
        if (/^(?:node:)?child_process$|^(?:node:)?https?$|^undici$/.test(specifier)) {
          violations.push(`${file}: imports ${specifier}`);
          continue;
        }
        if (!specifier.startsWith('.')) continue;
        const dependency = resolve(
          dirname(file),
          specifier.replace(/\.js$/, '.ts'),
        );
        await inspect(dependency);
      }
      if (/\b(?:exec|execFile|spawn|fork|fetch)\s*\(/.test(source)) {
        violations.push(`${file}: calls a prohibited process or network primitive`);
      }
    };

    await inspect(entry);

    expect(violations).toEqual([]);
  });

  it('completes while process and network sentinels throw on every call', async () => {
    vi.stubGlobal('fetch', (): never => { throw new Error('NETWORK_SENTINEL_CALLED'); });
    const { session, workspaceManager } = await createDemoSession('sentinel-demo');
    const runner = createPublicDemoRunner({
      emit: () => undefined,
      workspaceManager,
    });

    await expect(runner.run(session)).resolves.toEqual({
      status: 'completed',
      sessionId: 'sentinel-demo',
    });
  });

  it('stops before emitting or correcting files when aborted at the first async boundary', async () => {
    const { session, workspaceManager } = await createDemoSession('aborted-demo');
    const events: Array<Pick<SSEEvent, 'type' | 'data'>> = [];
    const controller = new AbortController();
    const runner = createPublicDemoRunner({
      emit: (type, data) => { events.push({ type, data }); },
      workspaceManager,
    });

    const completion = runner.run(session, controller.signal);
    controller.abort();

    await expect(completion).rejects.toThrow('DEMO_ABORTED');
    expect(events).toEqual([]);
    await expect(readFile(join(session.workspace, 'demo.ts'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('aborts an in-flight initial write before commit with no file or tool event', async () => {
    const { session, workspaceManager } = await createDemoSession('deferred-initial-demo');
    const deferred = deferWriteCall(workspaceManager, 1);
    const controller = new AbortController();
    const events: Array<Pick<SSEEvent, 'type' | 'data'>> = [];
    const runner = createPublicDemoRunner({
      emit: (type, data) => { events.push({ type, data }); },
      workspaceManager: deferred.manager,
    });

    const completion = runner.run(session, controller.signal);
    await deferred.started;
    controller.abort();
    deferred.release();

    await expect(completion).rejects.toThrow(/abort/i);
    expect(deferred.committedWrites()).toBe(0);
    expect(events).toEqual([]);
    await expect(readFile(join(session.workspace, 'demo.ts'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('aborts an in-flight corrected write before commit and keeps the initial file', async () => {
    const { session, workspaceManager } = await createDemoSession('deferred-correction-demo');
    const deferred = deferWriteCall(workspaceManager, 2);
    const controller = new AbortController();
    const events: Array<Pick<SSEEvent, 'type' | 'data'>> = [];
    const runner = createPublicDemoRunner({
      emit: (type, data) => { events.push({ type, data }); },
      workspaceManager: deferred.manager,
    });

    const completion = runner.run(session, controller.signal);
    await deferred.started;
    controller.abort();
    deferred.release();

    await expect(completion).rejects.toThrow(/abort/i);
    expect(deferred.committedWrites()).toBe(1);
    expect(events.some((event) => (
      (event.data as { stage?: string }).stage === 'corrected_write'
    ))).toBe(false);
    await expect(readFile(join(session.workspace, 'demo.ts'), 'utf8'))
      .resolves.toBe("export const greeting = 'hello';\n");
  });

  it('keeps concurrent runs deterministic and isolated on one runner instance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-public-demo-concurrent-'));
    temporaryRoots.push(root);
    const workspaceManager = createWorkspaceManager({ root });
    const makeSession = async (id: string): Promise<PublicSession> => ({
      id,
      clientKey: 'shared-client',
      workspace: await workspaceManager.create(id),
      status: 'running',
      createdAt: new Date('2026-08-08T00:00:00.000Z'),
      expiresAt: new Date('2026-08-08T01:00:00.000Z'),
    });
    const [first, second] = await Promise.all([
      makeSession('concurrent-one'),
      makeSession('concurrent-two'),
    ]);
    const events: Array<Pick<SSEEvent, 'type' | 'data'>> = [];
    const runner = createPublicDemoRunner({
      emit: (type, data) => { events.push({ type, data }); },
      workspaceManager,
      now: () => new Date('2026-08-08T00:00:00.000Z'),
    });

    const results = await Promise.all([runner.run(first), runner.run(second)]);
    const stagesFor = (sessionId: string): string[] => events
      .filter((event) => (event.data as { sessionId?: string }).sessionId === sessionId)
      .map((event) => (event.data as { stage: string }).stage);

    expect(results).toEqual([
      { status: 'completed', sessionId: 'concurrent-one' },
      { status: 'completed', sessionId: 'concurrent-two' },
    ]);
    expect(stagesFor(first.id)).toEqual(stagesFor(second.id));
    expect(stagesFor(first.id)).toEqual([
      'initial_write',
      'dangerous_action_blocked',
      'validation_failed',
      'structured_feedback',
      'corrected_write',
      'validation_passed',
      'demo_complete',
    ]);
    await expect(readFile(join(first.workspace, 'demo.ts'), 'utf8'))
      .resolves.toBe("export const greeting = 'hello, harness';\n");
    await expect(readFile(join(second.workspace, 'demo.ts'), 'utf8'))
      .resolves.toBe("export const greeting = 'hello, harness';\n");
  });
});
