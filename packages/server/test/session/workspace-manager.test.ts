import * as nodeFs from 'node:fs/promises';
import * as nodeSyncFs from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createWorkspaceManager,
  type WorkspaceFileSystem,
} from '../../src/session/workspace-manager.js';

const temporaryPaths: string[] = [];

const createTemporaryDirectory = async (prefix: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryPaths.push(directory);
  return directory;
};

const createWorkspaceClientSwapFileSystem = (
  root: string,
  canonicalSubstitute?: { target: string; replacement: string },
): {
  fs: WorkspaceFileSystem;
  replacementWasPreserved: () => Promise<boolean>;
  quarantineIsPrivate: () => boolean;
} => {
  const target = canonicalSubstitute?.target ?? join(root, 'session-one');
  let replacementSentinel: string | undefined;
  let substituteCanonicalPath = true;
  let quarantineRoot: string | undefined;
  let quarantineMode: number | undefined;
  let isolatedTarget: string | undefined;
  const fs: WorkspaceFileSystem = {
    async mkdir(path, options) {
      const result = options
        ? await nodeFs.mkdir(path, options)
        : await nodeFs.mkdir(path);
      if (
        dirname(path) === root
        && basename(path).startsWith('.harness-quarantine-')
      ) {
        quarantineRoot = path;
        quarantineMode = options?.mode;
      }
      return result;
    },
    async lstat(path, options) {
      const stats = await nodeFs.lstat(path, options);
      if (
        quarantineRoot
        && isolatedTarget
        && dirname(path) === quarantineRoot
        && !replacementSentinel
      ) {
        // Model the strongest operation available to a workspace client: it can
        // replace only its exposed workspace path, not the private quarantine.
        await nodeFs.mkdir(isolatedTarget);
        replacementSentinel = join(isolatedTarget, 'keep.txt');
        await nodeFs.writeFile(replacementSentinel, 'unowned');
      }
      return stats;
    },
    async realpath(path) {
      const canonicalPath = await nodeFs.realpath(path);
      if (
        canonicalSubstitute
        && path === canonicalSubstitute.target
        && substituteCanonicalPath
      ) {
        substituteCanonicalPath = false;
        return canonicalSubstitute.replacement;
      }
      return canonicalPath;
    },
    async rename(oldPath, newPath) {
      await nodeFs.rename(oldPath, newPath);
      if (oldPath === target && quarantineRoot && dirname(newPath) === quarantineRoot) {
        isolatedTarget = oldPath;
      }
    },
    rm: (path, options) => nodeFs.rm(path, options),
  };

  return {
    fs,
    async replacementWasPreserved() {
      if (!replacementSentinel) {
        return false;
      }
      try {
        return await nodeFs.readFile(replacementSentinel, 'utf8') === 'unowned';
      } catch {
        return false;
      }
    },
    quarantineIsPrivate() {
      return quarantineRoot !== undefined
        && dirname(quarantineRoot) === root
        && quarantineMode === 0o700;
    },
  };
};

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

describe('createWorkspaceManager', () => {
  it('returns only canonical paths issued under its server-owned session key', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const manager = createWorkspaceManager({ root });
    const issued = await manager.create('session-one');

    expect(manager.getIssuedPath('session-one')).toBe(issued);
    expect(manager.getIssuedPath('unknown-session')).toBeNull();
  });

  it('asserts that a caller path exactly matches the server-issued session path', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const outside = await createTemporaryDirectory('harness-outside-');
    const manager = createWorkspaceManager({ root });
    const issued = await manager.create('session-one');

    expect(manager.assertIssued('session-one', issued)).toBe(issued);
    expect(() => manager.assertIssued('session-one', outside)).toThrow(/issued|match|workspace/i);
    expect(() => manager.assertIssued('unknown-session', issued)).toThrow(/issued|session/i);
  });

  it('atomically replaces an issued workspace file without trusting a caller path', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const manager = createWorkspaceManager({ root });
    const issued = await manager.create('session-one');

    await manager.writeIssuedFile('session-one', 'demo.ts', 'initial');
    await manager.writeIssuedFile('session-one', 'demo.ts', 'corrected');

    expect(await readFile(join(issued, 'demo.ts'), 'utf8')).toBe('corrected');
  });

  it('rejects nested file paths so the commit target is always a direct child', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const manager = createWorkspaceManager({ root });
    const issued = await manager.create('session-one');

    await expect(manager.writeIssuedFile('session-one', 'nested/demo.ts', 'unsafe'))
      .rejects.toThrow(/direct child|file name|nested/i);
    await expect(readFile(join(issued, 'nested', 'demo.ts'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not yield between the final target check and descriptor commit', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const outside = await createTemporaryDirectory('harness-outside-');
    const sentinel = join(outside, 'keep.txt');
    await writeFile(sentinel, 'safe');
    let scheduledSwap: Promise<void> | undefined;
    let target = '';
    const commitFs = {
      lstatSync: nodeSyncFs.lstatSync,
      openSync(path: nodeSyncFs.PathLike, flags: number, mode?: number) {
        if (String(path) === target && !scheduledSwap) {
          scheduledSwap = Promise.resolve().then(async () => {
            await rename(target, `${target}-committed`);
            await symlink(
              outside,
              target,
              process.platform === 'win32' ? 'junction' : 'dir',
            );
          });
        }
        return nodeSyncFs.openSync(path, flags, mode);
      },
      fstatSync: nodeSyncFs.fstatSync,
      ftruncateSync: nodeSyncFs.ftruncateSync,
      writeSync: nodeSyncFs.writeSync,
      fsyncSync: nodeSyncFs.fsyncSync,
      closeSync: nodeSyncFs.closeSync,
    };
    const manager = createWorkspaceManager({ root, commitFs });
    const issued = await manager.create('session-one');
    target = join(issued, 'demo.ts');

    await manager.writeIssuedFile('session-one', 'demo.ts', 'committed safely');
    await scheduledSwap;

    expect(scheduledSwap).toBeDefined();
    expect(await readFile(`${target}-committed`, 'utf8')).toBe('committed safely');
    expect(await readFile(sentinel, 'utf8')).toBe('safe');
  });

  it('aborts after deferred preparation without entering the synchronous commit', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    let issued = '';
    let deferWorkspaceIdentity = false;
    let enteredPreparation!: () => void;
    const preparationStarted = new Promise<void>((resolve) => { enteredPreparation = resolve; });
    let releasePreparation!: () => void;
    const preparationGate = new Promise<void>((resolve) => { releasePreparation = resolve; });
    let openCalls = 0;
    const fs: WorkspaceFileSystem = {
      mkdir: (path, options) => options
        ? nodeFs.mkdir(path, options)
        : nodeFs.mkdir(path),
      async lstat(path, options) {
        if (deferWorkspaceIdentity && path === issued) {
          deferWorkspaceIdentity = false;
          enteredPreparation();
          await preparationGate;
        }
        return nodeFs.lstat(path, options);
      },
      realpath: (path) => nodeFs.realpath(path),
      rename: (oldPath, newPath) => nodeFs.rename(oldPath, newPath),
      rm: (path, options) => nodeFs.rm(path, options),
    };
    const commitFs = {
      ...nodeSyncFs,
      openSync(path: nodeSyncFs.PathLike, flags: number, mode?: number) {
        openCalls += 1;
        return nodeSyncFs.openSync(path, flags, mode);
      },
    };
    const manager = createWorkspaceManager({ root, fs, commitFs });
    issued = await manager.create('session-one');
    deferWorkspaceIdentity = true;
    const controller = new AbortController();

    const write = manager.writeIssuedFile('session-one', 'demo.ts', 'late', controller.signal);
    await preparationStarted;
    controller.abort();
    releasePreparation();

    await expect(write).rejects.toThrow(/abort/i);
    expect(openCalls).toBe(0);
    await expect(readFile(join(issued, 'demo.ts'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects repository metadata writes as defense in depth', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const manager = createWorkspaceManager({ root });
    const issued = await manager.create('session-one');

    await expect(manager.writeIssuedFile('session-one', '.git/config', 'unsafe'))
      .rejects.toThrow(/repository|git|protected/i);

    await expect(realpath(join(issued, '.git'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a target junction without changing its external sentinel', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const outside = await createTemporaryDirectory('harness-outside-');
    const manager = createWorkspaceManager({ root });
    const issued = await manager.create('session-one');
    const sentinel = join(outside, 'keep.txt');
    await writeFile(sentinel, 'safe');
    await symlink(outside, join(issued, 'demo.ts'), process.platform === 'win32' ? 'junction' : 'dir');

    await expect(manager.writeIssuedFile('session-one', 'demo.ts', 'unsafe'))
      .rejects.toThrow(/symbolic|link|target/i);

    expect(await readFile(sentinel, 'utf8')).toBe('safe');
  });

  it('rejects a nested junction path without writing outside the issued workspace', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const outside = await createTemporaryDirectory('harness-outside-');
    const manager = createWorkspaceManager({ root });
    const issued = await manager.create('session-one');
    const sentinel = join(outside, 'keep.txt');
    await writeFile(sentinel, 'safe');
    await symlink(outside, join(issued, 'nested'), process.platform === 'win32' ? 'junction' : 'dir');

    await expect(manager.writeIssuedFile('session-one', 'nested/demo.ts', 'unsafe'))
      .rejects.toThrow(/direct child|nested|symbolic|link/i);

    expect(await readFile(sentinel, 'utf8')).toBe('safe');
    await expect(realpath(join(outside, 'demo.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects writes after an issued workspace is replaced at the same path', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const manager = createWorkspaceManager({ root });
    const issued = await manager.create('session-one');
    await rename(issued, `${issued}-original`);
    await mkdir(issued);
    const sentinel = join(issued, 'keep.txt');
    await writeFile(sentinel, 'unowned');

    await expect(manager.writeIssuedFile('session-one', 'demo.ts', 'unsafe'))
      .rejects.toThrow(/identity|changed/i);

    expect(await readFile(sentinel, 'utf8')).toBe('unowned');
  });

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

  it('rolls back its new child when post-creation validation fails', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const outside = await createTemporaryDirectory('harness-outside-');
    const target = join(root, 'session-one');
    let substituteCanonicalPath = true;
    const fs: WorkspaceFileSystem = {
      mkdir: (path, options) => options
        ? nodeFs.mkdir(path, options)
        : nodeFs.mkdir(path),
      lstat: (path, options) => nodeFs.lstat(path, options),
      async realpath(path) {
        const canonicalPath = await nodeFs.realpath(path);
        if (path === target && substituteCanonicalPath) {
          substituteCanonicalPath = false;
          return outside;
        }
        return canonicalPath;
      },
      rename: (oldPath, newPath) => nodeFs.rename(oldPath, newPath),
      rm: (path, options) => nodeFs.rm(path, options),
    };
    const manager = createWorkspaceManager({ root, fs });

    await expect(manager.create('session-one')).rejects.toThrow(/outside|changed/i);

    await expect(realpath(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await realpath(outside)).toBe(outside);
  });

  it('does not delete a client replacement swapped after the final removal identity check', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const attack = createWorkspaceClientSwapFileSystem(root);
    const manager = createWorkspaceManager({ root, fs: attack.fs });
    await manager.create('session-one');

    await manager.remove('session-one');

    expect(attack.quarantineIsPrivate()).toBe(true);
    expect(await attack.replacementWasPreserved()).toBe(true);
  });

  it('does not delete a client replacement swapped after the rollback identity check', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const outside = await createTemporaryDirectory('harness-outside-');
    const target = join(root, 'session-one');
    const attack = createWorkspaceClientSwapFileSystem(root, {
      target,
      replacement: outside,
    });
    const manager = createWorkspaceManager({ root, fs: attack.fs });

    await expect(manager.create('session-one')).rejects.toThrow(/outside|changed/i);

    expect(attack.quarantineIsPrivate()).toBe(true);
    expect(await attack.replacementWasPreserved()).toBe(true);
  });

  it('fail-closed quarantines a new child when its first identity read fails', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const target = join(root, 'session-one');
    let failTargetIdentity = true;
    const fs: WorkspaceFileSystem = {
      mkdir: (path, options) => options
        ? nodeFs.mkdir(path, options)
        : nodeFs.mkdir(path),
      async lstat(path, options) {
        if (path === target && failTargetIdentity) {
          failTargetIdentity = false;
          throw new Error('injected identity read failure');
        }
        return nodeFs.lstat(path, options);
      },
      realpath: (path) => nodeFs.realpath(path),
      rename: (oldPath, newPath) => nodeFs.rename(oldPath, newPath),
      rm: (path, options) => nodeFs.rm(path, options),
    };
    const manager = createWorkspaceManager({ root, fs });

    await expect(manager.create('session-one')).rejects.toThrow(/identity read failure/i);
    await expect(realpath(target)).rejects.toMatchObject({ code: 'ENOENT' });
    const quarantine = (await readdir(root)).find((entry) => (
      entry.startsWith('.harness-quarantine-')
    ));
    expect(quarantine).toBeDefined();
    expect(await readdir(join(root, quarantine!))).toEqual([]);
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

  it('refuses removal when an issued child is replaced by a new directory at the same path', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const manager = createWorkspaceManager({ root });
    const issued = await manager.create('session-one');
    const original = `${issued}-original`;
    await rename(issued, original);
    await mkdir(issued);
    const sentinel = join(issued, 'keep.txt');
    await writeFile(sentinel, 'unowned');

    await expect(manager.remove('session-one')).rejects.toThrow(/changed|identity/i);

    expect(await readFile(sentinel, 'utf8')).toBe('unowned');
    expect(await realpath(original)).toBe(original);
  });

  it('uses lossless bigint identities that cannot collapse above the safe integer range', async () => {
    const root = await createTemporaryDirectory('harness-workspaces-');
    const target = join(root, 'session-one');
    let originalPhysicalInode: bigint | undefined;
    const firstIdentity = 9_007_199_254_740_992n;
    const replacementIdentity = firstIdentity + 1n;
    expect(Number(firstIdentity)).toBe(Number(replacementIdentity));

    const fs: WorkspaceFileSystem = {
      mkdir: (path, options) => options
        ? nodeFs.mkdir(path, options)
        : nodeFs.mkdir(path),
      async lstat(path, options) {
        if (options.bigint !== true) {
          throw new Error('lossless identity required');
        }
        const stats = await nodeFs.lstat(path, { bigint: true });
        if (path === root) {
          return {
            dev: 1n,
            ino: 1n,
            isDirectory: () => stats.isDirectory(),
            isSymbolicLink: () => stats.isSymbolicLink(),
          };
        }
        if (
          dirname(path) === root
          && basename(path).startsWith('.harness-quarantine-')
        ) {
          return {
            dev: 1n,
            ino: 2n,
            isDirectory: () => stats.isDirectory(),
            isSymbolicLink: () => stats.isSymbolicLink(),
          };
        }

        originalPhysicalInode ??= stats.ino;
        const identity = stats.ino === originalPhysicalInode
          ? firstIdentity
          : replacementIdentity;
        return {
          dev: 2n,
          ino: identity,
          isDirectory: () => stats.isDirectory(),
          isSymbolicLink: () => stats.isSymbolicLink(),
        };
      },
      realpath: (path) => nodeFs.realpath(path),
      rename: (oldPath, newPath) => nodeFs.rename(oldPath, newPath),
      rm: (path, options) => nodeFs.rm(path, options),
    };
    const manager = createWorkspaceManager({ root, fs });
    const issued = await manager.create('session-one');
    await rename(issued, `${issued}-original`);
    await mkdir(issued);
    const sentinel = join(issued, 'keep.txt');
    await writeFile(sentinel, 'unowned');

    await expect(manager.remove('session-one')).rejects.toThrow(/identity/i);
    expect(await readFile(sentinel, 'utf8')).toBe('unowned');
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
