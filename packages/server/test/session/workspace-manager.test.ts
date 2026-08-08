import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspaceManager } from '../../src/session/workspace-manager.js';

const temporaryPaths: string[] = [];

const createTemporaryDirectory = async (prefix: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryPaths.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

describe('createWorkspaceManager', () => {
  it('creates distinct canonical direct children beneath the configured root', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const manager = createWorkspaceManager({ root });

    const first = await manager.create('session-one');
    const second = await manager.create('session-two');

    expect(first).not.toBe(second);
    expect(dirname(first)).toBe(await realpath(root));
    expect(dirname(second)).toBe(await realpath(root));
    expect(basename(first)).toBe('session-one');
    expect(basename(second)).toBe('session-two');
  });

  it.each(['../escape', '..', '.', 'nested/session', 'nested\\session', '/absolute'])(
    'rejects the traversal-capable session id %j',
    async (sessionId) => {
      const root = await createTemporaryDirectory('harness-workspaces-');
      const manager = createWorkspaceManager({ root });

      await expect(manager.create(sessionId)).rejects.toThrow(/session id/i);
    },
  );

  it('rejects removal of a workspace it did not issue', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const manager = createWorkspaceManager({ root });

    await expect(manager.remove('not-issued')).rejects.toThrow(/not issued/i);
  });

  it('never adopts or removes a pre-existing child directory', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const existing = join(root, 'existing-session');
    const sentinel = join(existing, 'keep.txt');
    await mkdir(existing);
    await writeFile(sentinel, 'owned elsewhere', { flush: true });
    const manager = createWorkspaceManager({ root });

    await expect(manager.create('existing-session')).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(manager.remove('existing-session')).rejects.toThrow(/not issued/i);
    expect(await readFile(sentinel, 'utf8')).toBe('owned elsewhere');
  });

  it('refuses recursive removal when an issued child is replaced with an external link', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const outside = await createTemporaryDirectory('harness-outside-');
    const manager = createWorkspaceManager({ root });
    const issued = await manager.create('session-one');
    const displaced = `${issued}-displaced`;
    const sentinel = join(outside, 'keep.txt');
    await writeFile(sentinel, 'safe');
    await rename(issued, displaced);
    await symlink(outside, issued, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(manager.remove('session-one')).rejects.toThrow(/outside|changed/i);
    expect(await readFile(sentinel, 'utf8')).toBe('safe');
  });

  it('recursively removes only the issued workspace', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const manager = createWorkspaceManager({ root });
    const issued = await manager.create('session-one');
    await writeFile(join(issued, 'artifact.txt'), 'temporary');

    await manager.remove('session-one');

    await expect(realpath(issued)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(manager.remove('session-one')).rejects.toThrow(/not issued/i);
  });
});
