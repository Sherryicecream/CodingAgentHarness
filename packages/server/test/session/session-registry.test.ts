import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConcurrentSessionLimitError,
  DuplicateSessionStartError,
  InvalidSessionTransitionError,
  createSessionRegistry,
} from '../../src/session/session-registry.js';
import { createWorkspaceManager } from '../../src/session/workspace-manager.js';

const temporaryPaths: string[] = [];

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'harness-registry-'));
  temporaryPaths.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

describe('createSessionRegistry', () => {
  it('issues a server-generated session with only lifecycle record fields', async () => {
    const root = await createRoot();
    const createdAt = new Date('2026-08-08T00:00:00.000Z');
    const registry = createSessionRegistry({
      workspaceManager: createWorkspaceManager({ root }),
      now: () => new Date(createdAt),
      idGenerator: () => 'server-generated-id',
    });

    const session = await registry.issue('client-a');

    expect(session).toEqual({
      id: 'server-generated-id',
      clientKey: 'client-a',
      workspace: join(root, 'server-generated-id'),
      status: 'issued',
      createdAt,
      expiresAt: new Date('2026-08-08T01:00:00.000Z'),
    });
    expect(Object.keys(session).sort()).toEqual([
      'clientKey',
      'createdAt',
      'expiresAt',
      'id',
      'status',
      'workspace',
    ]);
  });

  it('returns a session only to its owning client key', async () => {
    const root = await createRoot();
    const registry = createSessionRegistry({
      workspaceManager: createWorkspaceManager({ root }),
      idGenerator: () => 'owned-session',
    });
    const session = await registry.issue('client-a');

    expect(registry.getAuthorized(session.id, 'client-a')).toEqual(session);
    expect(registry.getAuthorized(session.id, 'client-b')).toBeNull();
    expect(registry.getAuthorized('unknown-session', 'client-a')).toBeNull();
  });

  it('expires sessions at exactly the default one-hour boundary', async () => {
    const root = await createRoot();
    let currentTime = new Date('2026-08-08T00:00:00.000Z');
    const registry = createSessionRegistry({
      workspaceManager: createWorkspaceManager({ root }),
      now: () => new Date(currentTime),
      idGenerator: () => 'expiring-session',
    });
    const session = await registry.issue('client-a');
    registry.start(session.id, 'client-a');

    currentTime = new Date('2026-08-08T00:59:59.999Z');
    expect(registry.getAuthorized(session.id, 'client-a')?.status).toBe('running');

    currentTime = new Date('2026-08-08T01:00:00.000Z');
    expect(registry.getAuthorized(session.id, 'client-a')).toBeNull();
  });

  it('deterministically removes every workspace at its expiry boundary', async () => {
    const root = await createRoot();
    let currentTime = new Date('2026-08-08T00:00:00.000Z');
    const ids = ['issued-session', 'running-session', 'completed-session', 'failed-session'];
    const registry = createSessionRegistry({
      workspaceManager: createWorkspaceManager({ root }),
      now: () => new Date(currentTime),
      idGenerator: () => ids.shift()!,
    });
    const issued = await registry.issue('client-a');
    const running = await registry.issue('client-a');
    const completed = await registry.issue('client-a');
    const failed = await registry.issue('client-a');
    registry.start(running.id, 'client-a');
    registry.start(completed.id, 'client-a');
    registry.complete(completed.id, 'client-a');
    registry.start(failed.id, 'client-a');
    registry.fail(failed.id, 'client-a');

    currentTime = new Date('2026-08-08T01:00:00.000Z');
    expect(await registry.sweepExpired()).toBe(4);

    await expect(realpath(issued.workspace)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(realpath(running.workspace)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(realpath(completed.workspace)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(realpath(failed.workspace)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(registry.getAuthorized(issued.id, 'client-a')).toBeNull();
    expect(registry.getAuthorized(running.id, 'client-a')).toBeNull();
  });

  it('rejects a duplicate start and permits only running sessions to terminate', async () => {
    const root = await createRoot();
    const ids = ['completed-session', 'failed-session'];
    const registry = createSessionRegistry({
      workspaceManager: createWorkspaceManager({ root }),
      idGenerator: () => ids.shift()!,
    });
    const completed = await registry.issue('client-a');
    const failed = await registry.issue('client-a');

    expect(() => registry.complete(completed.id, 'client-a'))
      .toThrow(InvalidSessionTransitionError);
    expect(registry.start(completed.id, 'client-a').status).toBe('running');
    expect(() => registry.start(completed.id, 'client-a'))
      .toThrow(DuplicateSessionStartError);
    expect(registry.complete(completed.id, 'client-a').status).toBe('completed');
    expect(() => registry.start(completed.id, 'client-a'))
      .toThrow(DuplicateSessionStartError);

    expect(registry.start(failed.id, 'client-a').status).toBe('running');
    expect(registry.fail(failed.id, 'client-a').status).toBe('failed');
    expect(() => registry.start(failed.id, 'client-a'))
      .toThrow(DuplicateSessionStartError);
    expect(() => registry.fail(failed.id, 'client-a'))
      .toThrow(InvalidSessionTransitionError);
  });

  it('rejects the third running session per client and ignores non-running sessions', async () => {
    const root = await createRoot();
    const ids = ['first', 'second', 'third', 'other-client'];
    const registry = createSessionRegistry({
      workspaceManager: createWorkspaceManager({ root }),
      idGenerator: () => ids.shift()!,
    });
    const first = await registry.issue('client-a');
    const second = await registry.issue('client-a');
    const third = await registry.issue('client-a');
    const otherClient = await registry.issue('client-b');

    registry.start(first.id, 'client-a');
    registry.start(second.id, 'client-a');
    expect(() => registry.start(third.id, 'client-a'))
      .toThrow(ConcurrentSessionLimitError);
    expect(registry.start(otherClient.id, 'client-b').status).toBe('running');

    registry.complete(first.id, 'client-a');
    expect(registry.start(third.id, 'client-a').status).toBe('running');
  });
});
