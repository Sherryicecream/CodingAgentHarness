import { createHash } from 'node:crypto';
import { posix } from 'node:path';

export interface ArtifactRecord {
  readonly relativePath: string;
  readonly operation: 'created';
  readonly size: number;
  readonly sha256: string;
  readonly timestamp: string;
  readonly toolCallId: string;
}

export interface RecordArtifactInput {
  readonly relativePath: string;
  readonly content: Uint8Array;
  readonly toolCallId: string;
}

export interface ArtifactTracker {
  record(input: RecordArtifactInput): ArtifactRecord;
  list(): readonly ArtifactRecord[];
}

export interface ArtifactTrackerOptions {
  readonly now?: () => Date;
}

const normalizeRelativePath = (value: string): string => {
  const portable = value.replaceAll('\\', '/');
  const normalized = posix.normalize(portable);
  if (
    value.length === 0
    || portable.startsWith('/')
    || /^[a-z]:\//i.test(portable)
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized === '.git'
    || normalized.startsWith('.git/')
  ) {
    throw new Error('Artifact path must remain inside the session workspace');
  }
  return normalized;
};

export const createArtifactTracker = (options: ArtifactTrackerOptions = {}): ArtifactTracker => {
  const now = options.now ?? (() => new Date());
  const records = new Map<string, ArtifactRecord>();
  return {
    record(input) {
      const relativePath = normalizeRelativePath(input.relativePath);
      const record = Object.freeze({
        relativePath,
        operation: 'created' as const,
        size: input.content.byteLength,
        sha256: createHash('sha256').update(input.content).digest('hex'),
        timestamp: now().toISOString(),
        toolCallId: input.toolCallId,
      });
      records.set(relativePath, record);
      return record;
    },
    list() {
      return Object.freeze([...records.values()]);
    },
  };
};
