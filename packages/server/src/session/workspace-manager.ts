import * as nodeFs from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export interface WorkspaceFileSystem {
  mkdir(path: string, options?: { recursive: true }): Promise<unknown>;
  realpath(path: string): Promise<string>;
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

export const createWorkspaceManager = (
  options: WorkspaceManagerOptions,
): WorkspaceManager => {
  const fs = options.fs ?? nodeFs;
  const configuredRoot = resolve(options.root);
  const issuedPaths = new Map<string, string>();
  let canonicalRoot: Promise<string> | undefined;
  const getCanonicalRoot = (): Promise<string> => {
    canonicalRoot ??= fs.mkdir(configuredRoot, { recursive: true })
      .then(() => fs.realpath(configuredRoot))
      .then((path) => resolve(path));
    return canonicalRoot;
  };

  return {
    async create(sessionId) {
      assertValidSessionId(sessionId);
      if (issuedPaths.has(sessionId)) {
        throw new Error(`Workspace already issued for session id: ${sessionId}`);
      }

      const root = await getCanonicalRoot();
      const target = resolve(join(root, sessionId));
      assertDirectChild(root, target);
      await fs.mkdir(target);

      const canonicalTarget = resolve(await fs.realpath(target));
      assertDirectChild(root, canonicalTarget);
      if (canonicalTarget !== target) {
        throw new Error('Workspace target changed during creation');
      }

      issuedPaths.set(sessionId, canonicalTarget);
      return canonicalTarget;
    },

    async remove(sessionId) {
      assertValidSessionId(sessionId);
      const issuedTarget = issuedPaths.get(sessionId);
      if (!issuedTarget) {
        throw new Error(`Workspace was not issued for session id: ${sessionId}`);
      }

      const root = await getCanonicalRoot();
      assertDirectChild(root, issuedTarget);

      let currentTarget: string;
      try {
        currentTarget = resolve(await fs.realpath(issuedTarget));
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') {
          throw error;
        }
        issuedPaths.delete(sessionId);
        return;
      }

      assertDirectChild(root, currentTarget);
      if (currentTarget !== issuedTarget) {
        throw new Error('Issued workspace target changed before removal');
      }

      await fs.rm(currentTarget, { recursive: true, force: true });
      issuedPaths.delete(sessionId);
    },
  };
};
