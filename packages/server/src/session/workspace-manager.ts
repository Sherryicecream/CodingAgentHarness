import { randomUUID } from 'node:crypto';
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

export interface WorkspaceManagerOptions {
  readonly root: string;
  readonly fs?: WorkspaceFileSystem;
  readonly now?: () => Date;
}

export interface WorkspaceManager {
  create(sessionId: string): Promise<string>;
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

export const createWorkspaceManager = (
  options: WorkspaceManagerOptions,
): WorkspaceManager => {
  const fs = options.fs ?? nodeFs;
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
    canonicalRoot ??= fs.mkdir(configuredRoot, { recursive: true })
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

  return {
    async create(sessionId) {
      assertValidSessionId(sessionId);
      if (issuedWorkspaces.has(sessionId)) {
        throw new Error(`Workspace already issued for session id: ${sessionId}`);
      }

      const root = await getCanonicalRoot();
      await assertIdentity(root.path, root.identity);
      const target = resolve(join(root.path, sessionId));
      assertDirectChild(root.path, target);
      await fs.mkdir(target);

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
