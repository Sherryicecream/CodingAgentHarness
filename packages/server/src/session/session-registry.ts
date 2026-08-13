import { randomUUID } from 'node:crypto';
import type { WorkspaceManager } from './workspace-manager.js';

export const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1_000;
export const DEFAULT_MAX_CONCURRENT_SESSIONS = 2;

export type SessionStatus = 'issued' | 'running' | 'completed' | 'failed' | 'expired';
export type WorkspaceRetention = 'temporary';

export interface PublicSession {
  readonly id: string;
  readonly clientKey: string;
  readonly workspace: string;
  readonly retention: WorkspaceRetention;
  readonly status: SessionStatus;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

interface SessionRecord {
  readonly id: string;
  readonly clientKey: string;
  readonly workspace: string;
  readonly status: SessionStatus;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface SessionRegistryOptions {
  readonly workspaceManager: WorkspaceManager;
  readonly now?: () => Date;
  readonly idGenerator?: () => string;
  readonly ttlMs?: number;
  readonly maxConcurrent?: number;
}

export interface SweepExpiredOptions {
  readonly skipIds?: ReadonlySet<string>;
}

export interface SessionRegistry {
  issue(clientKey: string): Promise<PublicSession>;
  getAuthorized(id: string, clientKey: string): PublicSession | null;
  sweepExpired(options?: SweepExpiredOptions): Promise<number>;
  start(id: string, clientKey: string): PublicSession;
  complete(id: string, clientKey: string): PublicSession;
  fail(id: string, clientKey: string): PublicSession;
}

export class ConcurrentSessionLimitError extends Error {
  constructor() {
    super('Concurrent running session limit reached');
    this.name = 'ConcurrentSessionLimitError';
  }
}

export class DuplicateSessionStartError extends Error {
  constructor(id: string) {
    super(`Session is already running: ${id}`);
    this.name = 'DuplicateSessionStartError';
  }
}

export class InvalidSessionTransitionError extends Error {
  constructor(id: string, from: SessionStatus, to: SessionStatus) {
    super(`Cannot transition session ${id} from ${from} to ${to}`);
    this.name = 'InvalidSessionTransitionError';
  }
}

export class SessionNotFoundError extends Error {
  constructor() {
    super('Session not found');
    this.name = 'SessionNotFoundError';
  }
}

const toPublicSession = (record: SessionRecord): PublicSession => Object.freeze({
  id: record.id,
  clientKey: record.clientKey,
  workspace: record.workspace,
  retention: 'temporary',
  status: record.status,
  createdAt: new Date(record.createdAt),
  expiresAt: new Date(record.expiresAt),
});

const assertPositiveInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
};

const isWorkspaceReclaimable = (record: SessionRecord, timestamp: number): boolean => (
  record.status === 'completed'
  || record.status === 'failed'
  || timestamp >= record.expiresAt
);

export const createSessionRegistry = (
  options: SessionRegistryOptions,
): SessionRegistry => {
  const now = options.now ?? (() => new Date());
  const idGenerator = options.idGenerator ?? randomUUID;
  const ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  const maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_SESSIONS;
  const records = new Map<string, SessionRecord>();
  const reservedIds = new Set<string>();

  assertPositiveInteger(ttlMs, 'ttlMs');
  assertPositiveInteger(maxConcurrent, 'maxConcurrent');

  const expireDueSessions = (timestamp: number): void => {
    for (const [id, record] of records) {
      if (timestamp < record.expiresAt) {
        continue;
      }
      if (record.status !== 'issued' && record.status !== 'running') {
        continue;
      }
      records.set(id, { ...record, status: 'expired' });
    }
  };

  const ownedRecord = (id: string, clientKey: string): SessionRecord => {
    expireDueSessions(now().getTime());
    const record = records.get(id);
    if (!record || record.clientKey !== clientKey || record.status === 'expired') {
      throw new SessionNotFoundError();
    }
    return record;
  };

  const transitionRunningSession = (
    id: string,
    clientKey: string,
    status: 'completed' | 'failed',
  ): PublicSession => {
    const record = ownedRecord(id, clientKey);
    if (record.status !== 'running') {
      throw new InvalidSessionTransitionError(id, record.status, status);
    }
    const updated = { ...record, status };
    records.set(id, updated);
    return toPublicSession(updated);
  };

  return {
    async issue(clientKey) {
      const id = idGenerator();
      if (records.has(id) || reservedIds.has(id)) {
        throw new Error(`Session id already exists: ${id}`);
      }

      reservedIds.add(id);
      try {
        const createdAt = now().getTime();
        const workspace = await options.workspaceManager.create(id);
        const record: SessionRecord = {
          id,
          clientKey,
          workspace,
          status: 'issued',
          createdAt,
          expiresAt: createdAt + ttlMs,
        };
        records.set(id, record);
        return toPublicSession(record);
      } finally {
        reservedIds.delete(id);
      }
    },

    getAuthorized(id, clientKey) {
      const timestamp = now().getTime();
      expireDueSessions(timestamp);
      const record = records.get(id);
      if (
        !record
        || record.clientKey !== clientKey
        || record.status === 'expired'
        || timestamp >= record.expiresAt
      ) {
        return null;
      }
      return toPublicSession(record);
    },

    async sweepExpired(sweepOptions = {}) {
      const timestamp = now().getTime();
      expireDueSessions(timestamp);
      let removed = 0;
      const failures: unknown[] = [];
      for (const [id, record] of records) {
        if (!isWorkspaceReclaimable(record, timestamp) || sweepOptions.skipIds?.has(id)) {
          continue;
        }
        try {
          await options.workspaceManager.remove(id);
          records.delete(id);
          removed += 1;
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, 'One or more expired sessions could not be removed');
      }
      return removed;
    },

    start(id, clientKey) {
      const record = ownedRecord(id, clientKey);
      if (record.status !== 'issued') {
        throw new DuplicateSessionStartError(id);
      }

      const runningForClient = [...records.values()].filter((candidate) => (
        candidate.clientKey === clientKey && candidate.status === 'running'
      )).length;
      if (runningForClient >= maxConcurrent) {
        throw new ConcurrentSessionLimitError();
      }

      const updated: SessionRecord = { ...record, status: 'running' };
      records.set(id, updated);
      return toPublicSession(updated);
    },

    complete(id, clientKey) {
      return transitionRunningSession(id, clientKey, 'completed');
    },

    fail(id, clientKey) {
      return transitionRunningSession(id, clientKey, 'failed');
    },
  };
};
