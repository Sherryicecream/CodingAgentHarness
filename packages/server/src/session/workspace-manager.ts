import { randomUUID } from 'node:crypto';
import * as nodeSyncFs from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export interface WorkspaceStats {
  readonly dev: bigint;
  readonly ino: bigint;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface WorkspaceFileSystem {
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<unknown>;
  lstat(path: string, options: { bigint: true }): Promise<WorkspaceStats>;
  realpath(path: string): Promise<string>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, options: { recursive: true; force: true }): Promise<void>;
}

export interface WorkspaceCommitStats extends WorkspaceStats {
  isFile(): boolean;
}

export interface WorkspaceCommitFileSystem {
  lstatSync(path: string, options: { bigint: true }): WorkspaceCommitStats;
  openSync(path: string, flags: number, mode?: number): number;
  fstatSync(fd: number, options: { bigint: true }): WorkspaceCommitStats;
  writeSync(fd: number, buffer: Uint8Array, offset: number, length: number): number;
  fsyncSync(fd: number): void;
  closeSync(fd: number): void;
  renameSync(oldPath: string, newPath: string): void;
  unlinkSync(path: string): void;
}

export interface WorkspaceManagerOptions {
  readonly root: string;
  readonly fs?: WorkspaceFileSystem;
  readonly commitFs?: WorkspaceCommitFileSystem;
  readonly now?: () => Date;
}

export interface WorkspaceManager {
  create(sessionId: string): Promise<string>;
  getIssuedPath(sessionId: string): string | null;
  assertIssued(sessionId: string, path: string): string;
  writeIssuedFile(
    sessionId: string,
    filePath: string,
    content: string,
    signal?: AbortSignal,
  ): Promise<void>;
  saveIssuedFile(sessionId: string, filePath: string, projectRoot: string): Promise<string>;
  remove(sessionId: string): Promise<void>;
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const assertValidSessionId = (sessionId: string): void => {
  if (
    !SESSION_ID_PATTERN.test(sessionId)
    || isAbsolute(sessionId)
    || basename(sessionId) !== sessionId
  ) {
    throw new Error('Invalid session id');
  }
};

const assertDirectChild = (root: string, target: string): void => {
  if (target === root || dirname(target) !== root) {
    throw new Error('Workspace target is outside the configured root');
  }
};

const errorCode = (error: unknown): string | undefined => (
  typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
);

interface CanonicalRoot {
  readonly path: string;
  readonly identity: string;
  readonly quarantine: {
    readonly path: string;
    readonly identity: string;
  };
}

interface IssuedWorkspace {
  readonly location: 'issued';
  readonly path: string;
  readonly identity: string;
}

interface QuarantinedWorkspace {
  readonly location: 'quarantined';
  readonly path: string;
  readonly identity: string;
}

type OwnedWorkspace = IssuedWorkspace | QuarantinedWorkspace;

const identityOf = (stats: WorkspaceStats): string => `${stats.dev}:${stats.ino}`;

const defaultCommitFileSystem: WorkspaceCommitFileSystem = {
  lstatSync: (path) => nodeSyncFs.lstatSync(path, { bigint: true }),
  openSync: (path, flags, mode) => nodeSyncFs.openSync(path, flags, mode),
  fstatSync: (fd) => nodeSyncFs.fstatSync(fd, { bigint: true }),
  writeSync: (fd, buffer, offset, length) => (
    nodeSyncFs.writeSync(fd, buffer, offset, length)
  ),
  fsyncSync: (fd) => nodeSyncFs.fsyncSync(fd),
  closeSync: (fd) => nodeSyncFs.closeSync(fd),
  renameSync: (oldPath, newPath) => nodeSyncFs.renameSync(oldPath, newPath),
  unlinkSync: (path) => nodeSyncFs.unlinkSync(path),
};

export const createWorkspaceManager = (
  options: WorkspaceManagerOptions,
): WorkspaceManager => {
  const fs = options.fs ?? nodeFs;
  const commitFs = options.commitFs ?? defaultCommitFileSystem;
  const configuredRoot = resolve(options.root);
  const issuedWorkspaces = new Map<string, OwnedWorkspace>();
  let canonicalRoot: Promise<CanonicalRoot> | undefined;

  const readDirectoryIdentity = async (path: string): Promise<string> => {
    const stats = await fs.lstat(path, { bigint: true });
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Workspace identity changed');
    }
    return identityOf(stats);
  };

  const assertIdentity = async (
    path: string,
    expectedIdentity: string,
  ): Promise<void> => {
    if (await readDirectoryIdentity(path) !== expectedIdentity) {
      throw new Error('Workspace identity changed');
    }
  };

  const getCanonicalRoot = (): Promise<CanonicalRoot> => {
    canonicalRoot ??= fs.mkdir(configuredRoot, { recursive: true, mode: 0o700 })
      .then(() => fs.realpath(configuredRoot))
      .then(async (path) => {
        const canonicalPath = resolve(path);
        const rootIdentity = await readDirectoryIdentity(canonicalPath);
        const quarantinePath = resolve(join(
          canonicalPath,
          `.harness-quarantine-${randomUUID()}`,
        ));
        assertDirectChild(canonicalPath, quarantinePath);
        await fs.mkdir(quarantinePath, { mode: 0o700 });
        const canonicalQuarantinePath = resolve(await fs.realpath(quarantinePath));
        if (canonicalQuarantinePath !== quarantinePath) {
          throw new Error('Private quarantine target changed during creation');
        }
        return {
          path: canonicalPath,
          identity: rootIdentity,
          quarantine: {
            path: canonicalQuarantinePath,
            identity: await readDirectoryIdentity(canonicalQuarantinePath),
          },
        };
      });
    return canonicalRoot;
  };

  const quarantine = async (
    root: CanonicalRoot,
    workspace: IssuedWorkspace,
  ): Promise<QuarantinedWorkspace> => {
    assertDirectChild(root.path, workspace.path);
    await assertIdentity(root.path, root.identity);
    assertDirectChild(root.path, root.quarantine.path);
    await assertIdentity(root.quarantine.path, root.quarantine.identity);
    await assertIdentity(workspace.path, workspace.identity);

    const quarantinePath = resolve(join(
      root.quarantine.path,
      `${basename(workspace.path)}-${randomUUID()}`,
    ));
    assertDirectChild(root.quarantine.path, quarantinePath);
    await fs.rename(workspace.path, quarantinePath);

    return {
      location: 'quarantined',
      path: quarantinePath,
      identity: workspace.identity,
    };
  };

  const quarantinedWorkspaceExists = async (
    root: CanonicalRoot,
    workspace: QuarantinedWorkspace,
  ): Promise<boolean> => {
    assertDirectChild(root.path, root.quarantine.path);
    assertDirectChild(root.quarantine.path, workspace.path);
    await assertIdentity(root.path, root.identity);
    await assertIdentity(root.quarantine.path, root.quarantine.identity);
    try {
      await assertIdentity(workspace.path, workspace.identity);
      return true;
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        return false;
      }
      throw error;
    }
  };

  const quarantineUnverifiedChild = async (
    root: CanonicalRoot,
    target: string,
  ): Promise<void> => {
    assertDirectChild(root.path, target);
    await assertIdentity(root.path, root.identity);
    await assertIdentity(root.quarantine.path, root.quarantine.identity);
    const quarantinePath = resolve(join(
      root.quarantine.path,
      `unverified-${randomUUID()}`,
    ));
    assertDirectChild(root.quarantine.path, quarantinePath);
    await fs.rename(target, quarantinePath);
    await assertIdentity(root.path, root.identity);
    await assertIdentity(root.quarantine.path, root.quarantine.identity);
    await fs.rm(quarantinePath, { recursive: true, force: true });
  };

  const assertIssuedWorkspace = async (
    sessionId: string,
    root: CanonicalRoot,
  ): Promise<IssuedWorkspace> => {
    const workspace = issuedWorkspaces.get(sessionId);
    if (!workspace || workspace.location !== 'issued') {
      throw new Error(`Workspace was not issued for session id: ${sessionId}`);
    }
    assertDirectChild(root.path, workspace.path);
    await assertIdentity(root.path, root.identity);
    await assertIdentity(workspace.path, workspace.identity);
    return workspace;
  };

  const assertSynchronousDirectoryIdentity = (
    path: string,
    expectedIdentity: string,
  ): void => {
    const stats = commitFs.lstatSync(path, { bigint: true });
    if (
      !stats.isDirectory()
      || stats.isSymbolicLink()
      || identityOf(stats) !== expectedIdentity
    ) {
      throw new Error('Workspace identity changed');
    }
  };

  const assertWriteNotAborted = (signal?: AbortSignal): void => {
    if (signal?.aborted) throw new Error('Workspace write aborted');
  };

  const readSynchronousTarget = (target: string): WorkspaceCommitStats | null => {
    try {
      const stats = commitFs.lstatSync(target, { bigint: true });
      if (stats.isSymbolicLink()) throw new Error('File target is a symbolic link');
      if (!stats.isFile()) throw new Error('File target is not a regular file');
      return stats;
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null;
      throw error;
    }
  };

  const assertTargetUnchanged = (
    target: string,
    expected: WorkspaceCommitStats | null,
  ): void => {
    const current = readSynchronousTarget(target);
    if (
      (expected === null && current !== null)
      || (expected !== null && current === null)
      || (
        expected !== null
        && current !== null
        && identityOf(expected) !== identityOf(current)
      )
    ) {
      throw new Error('File target identity changed');
    }
  };

  const closePreparedDescriptor = (fd: number): void => {
    try {
      commitFs.closeSync(fd);
    } catch (closeError) {
      try {
        commitFs.closeSync(fd);
      } catch (retryError) {
        if (errorCode(retryError) !== 'EBADF') {
          throw new AggregateError(
            [closeError, retryError],
            'Workspace temporary descriptor close failed',
          );
        }
      }
      throw closeError;
    }
  };

  const cleanupOwnedTemporaryFile = (
    temporaryPath: string,
    expectedIdentity: string,
  ): void => {
    let current: WorkspaceCommitStats;
    try {
      current = commitFs.lstatSync(temporaryPath, { bigint: true });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      throw error;
    }
    if (
      current.isSymbolicLink()
      || !current.isFile()
      || identityOf(current) !== expectedIdentity
    ) {
      return;
    }
    commitFs.unlinkSync(temporaryPath);
  };

  const commitDirectChild = (
    root: CanonicalRoot,
    workspace: IssuedWorkspace,
    target: string,
    content: string,
    signal?: AbortSignal,
  ): void => {
    assertWriteNotAborted(signal);
    assertSynchronousDirectoryIdentity(root.path, root.identity);
    assertSynchronousDirectoryIdentity(workspace.path, workspace.identity);
    const targetBeforeCommit = readSynchronousTarget(target);
    const temporaryPath = resolve(join(
      workspace.path,
      `.harness-write-${randomUUID()}.tmp`,
    ));
    assertDirectChild(workspace.path, temporaryPath);
    const noFollow = nodeSyncFs.constants.O_NOFOLLOW ?? 0;
    const flags = nodeSyncFs.constants.O_WRONLY
      | noFollow
      | nodeSyncFs.constants.O_CREAT
      | nodeSyncFs.constants.O_EXCL;
    let fd: number | undefined;
    let temporaryIdentity: string | undefined;
    let renamed = false;
    try {
      // There is deliberately no await from the final identity checks through
      // rename. On Windows O_NOFOLLOW is unavailable, so lstat/open/fstat only
      // guarantees the remote-public threat model; it does not claim to defeat
      // a malicious same-account local process racing this synchronous section.
      fd = commitFs.openSync(temporaryPath, flags, 0o600);
      const descriptor = commitFs.fstatSync(fd, { bigint: true });
      if (!descriptor.isFile()) throw new Error('Write descriptor is not a regular file');
      temporaryIdentity = identityOf(descriptor);
      const temporaryAfterOpen = commitFs.lstatSync(temporaryPath, { bigint: true });
      if (
        temporaryAfterOpen.isSymbolicLink()
        || !temporaryAfterOpen.isFile()
        || identityOf(temporaryAfterOpen) !== temporaryIdentity
      ) {
        throw new Error('Temporary file identity changed');
      }

      const bytes = Buffer.from(content, 'utf8');
      let offset = 0;
      while (offset < bytes.length) {
        const written = commitFs.writeSync(fd, bytes, offset, bytes.length - offset);
        if (written <= 0) throw new Error('Workspace file write made no progress');
        offset += written;
      }
      commitFs.fsyncSync(fd);
      const preparedFd = fd;
      fd = undefined;
      closePreparedDescriptor(preparedFd);

      assertWriteNotAborted(signal);
      assertSynchronousDirectoryIdentity(root.path, root.identity);
      assertSynchronousDirectoryIdentity(workspace.path, workspace.identity);
      assertTargetUnchanged(target, targetBeforeCommit);
      commitFs.renameSync(temporaryPath, target);
      renamed = true;

      const committed = readSynchronousTarget(target);
      if (committed === null || identityOf(committed) !== temporaryIdentity) {
        throw new Error('Workspace final identity mismatch after rename');
      }
    } catch (error) {
      let failure: unknown = error;
      if (fd !== undefined) {
        const incompleteFd = fd;
        fd = undefined;
        try {
          closePreparedDescriptor(incompleteFd);
        } catch (closeError) {
          failure = new AggregateError(
            [failure, closeError],
            'Workspace temporary file operation and close failed',
          );
        }
      }
      if (!renamed && temporaryIdentity !== undefined) {
        try {
          cleanupOwnedTemporaryFile(temporaryPath, temporaryIdentity);
        } catch (cleanupError) {
          failure = new AggregateError(
            [failure, cleanupError],
            'Workspace write failed and temporary cleanup failed',
          );
        }
      }
      throw failure;
    }
  };

  return {
    getIssuedPath(sessionId) {
      assertValidSessionId(sessionId);
      const workspace = issuedWorkspaces.get(sessionId);
      return workspace?.location === 'issued' ? workspace.path : null;
    },

    assertIssued(sessionId, path) {
      assertValidSessionId(sessionId);
      const workspace = issuedWorkspaces.get(sessionId);
      if (workspace?.location !== 'issued' || workspace.path !== path) {
        throw new Error('Workspace path does not match the server-issued session path');
      }
      return workspace.path;
    },

    async create(sessionId) {
      assertValidSessionId(sessionId);
      if (issuedWorkspaces.has(sessionId)) {
        throw new Error(`Workspace already issued for session id: ${sessionId}`);
      }

      const root = await getCanonicalRoot();
      await assertIdentity(root.path, root.identity);
      const target = resolve(join(root.path, sessionId));
      assertDirectChild(root.path, target);
      await fs.mkdir(target, { mode: 0o700 });

      let created: IssuedWorkspace | undefined;
      try {
        created = {
          location: 'issued',
          path: target,
          identity: await readDirectoryIdentity(target),
        };
        const canonicalTarget = resolve(await fs.realpath(target));
        assertDirectChild(root.path, canonicalTarget);
        if (canonicalTarget !== target) {
          throw new Error('Workspace target changed during creation');
        }
        await assertIdentity(root.path, root.identity);
        await assertIdentity(target, created.identity);

        issuedWorkspaces.set(sessionId, created);
        return canonicalTarget;
      } catch (error) {
        if (!created) {
          try {
            await quarantineUnverifiedChild(root, target);
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              'Workspace creation failed and unverified child isolation was incomplete',
            );
          }
          throw error;
        }
        try {
          const quarantined = await quarantine(root, created);
          if (await quarantinedWorkspaceExists(root, quarantined)) {
            await fs.rm(quarantined.path, { recursive: true, force: true });
          }
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'Workspace creation failed and rollback was incomplete',
          );
        }
        throw error;
      }
    },

    async writeIssuedFile(sessionId, filePath, content, signal) {
      assertValidSessionId(sessionId);
      if (typeof filePath !== 'string' || filePath.length === 0 || isAbsolute(filePath)) {
        throw new Error('Invalid workspace file path');
      }
      if (filePath.split(/[\\/]/).some((segment) => segment.toLowerCase() === '.git')) {
        throw new Error('Repository metadata is protected');
      }
      if (basename(filePath) !== filePath || /[\\/]/.test(filePath) || filePath === '.') {
        throw new Error('Workspace file must be a direct child file name');
      }
      assertWriteNotAborted(signal);
      const root = await getCanonicalRoot();
      const workspace = await assertIssuedWorkspace(sessionId, root);
      const target = resolve(join(workspace.path, filePath));
      assertDirectChild(workspace.path, target);
      commitDirectChild(root, workspace, target, content, signal);
    },

    async saveIssuedFile(sessionId, filePath, projectRoot) {
      assertValidSessionId(sessionId);
      if (typeof projectRoot !== 'string' || !isAbsolute(projectRoot)) {
        throw new Error('Project root must be absolute');
      }
      if (typeof filePath !== 'string' || filePath.length === 0 || isAbsolute(filePath)
        || basename(filePath) !== filePath || /[\\/]/.test(filePath) || filePath === '.') {
        throw new Error('Workspace file must be a direct child file name');
      }
      const root = await getCanonicalRoot();
      const workspace = await assertIssuedWorkspace(sessionId, root);
      const source = resolve(join(workspace.path, filePath));
      assertDirectChild(workspace.path, source);
      const sourceStats = await fs.lstat(source, { bigint: true });
      if (sourceStats.isSymbolicLink() || !sourceStats.isFile()) {
        throw new Error('Workspace source must be a regular file');
      }
      const canonicalProject = resolve(await fs.realpath(projectRoot));
      const harnessDir = resolve(join(canonicalProject, '.harness'));
      const outputsDir = resolve(join(harnessDir, 'outputs'));
      await fs.mkdir(outputsDir, { recursive: true, mode: 0o700 });
      if (resolve(await fs.realpath(outputsDir)) !== outputsDir) {
        throw new Error('Output directory must not be a symbolic link');
      }
      const destination = resolve(join(outputsDir, filePath));
      if (dirname(destination) !== outputsDir) throw new Error('Invalid output path');
      try {
        const existing = await fs.lstat(destination, { bigint: true });
        if (existing.isSymbolicLink() || !existing.isFile()) throw new Error('Output target is unsafe');
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
      }
      await nodeFs.copyFile(source, destination, nodeFs.constants.COPYFILE_EXCL).catch(async (error) => {
        if (errorCode(error) === 'EEXIST') {
          await nodeFs.copyFile(source, destination);
          return;
        }
        throw error;
      });
      return destination;
    },

    async remove(sessionId) {
      assertValidSessionId(sessionId);
      const issuedWorkspace = issuedWorkspaces.get(sessionId);
      if (!issuedWorkspace) {
        throw new Error(`Workspace was not issued for session id: ${sessionId}`);
      }

      const root = await getCanonicalRoot();
      let quarantined: QuarantinedWorkspace;
      if (issuedWorkspace.location === 'issued') {
        try {
          quarantined = await quarantine(root, issuedWorkspace);
        } catch (error) {
          if (errorCode(error) === 'ENOENT') {
            throw new Error('Issued workspace identity changed before removal');
          }
          throw error;
        }
        issuedWorkspaces.set(sessionId, quarantined);
      } else {
        quarantined = issuedWorkspace;
      }

      if (await quarantinedWorkspaceExists(root, quarantined)) {
        await fs.rm(quarantined.path, { recursive: true, force: true });
      }
      issuedWorkspaces.delete(sessionId);
    },
  };
};
