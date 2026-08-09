export const PUBLIC_HISTORY_STORAGE_KEY = 'harness.public.session-history.v1';
const MAX_PUBLIC_HISTORY_ENTRIES = 50;

export interface PublicSessionHistory {
  readonly id: string;
  readonly createdAt: string;
  readonly task: string;
  readonly status: 'running' | 'blocked' | 'completed' | 'failed';
  readonly conclusion: string | null;
  readonly feedbackRuns: Array<{
    readonly iteration: number;
    readonly testResult: 'pass' | 'fail';
    readonly failureCount: number;
    readonly fixApplied: boolean;
    readonly timeSpent: number;
  }>;
}

const getBrowserStorage = (): Storage => window.localStorage;

const isPublicSessionHistory = (value: unknown): value is PublicSessionHistory => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<PublicSessionHistory>;
  return typeof entry.id === 'string'
    && typeof entry.createdAt === 'string'
    && typeof entry.task === 'string'
    && ['running', 'blocked', 'completed', 'failed'].includes(entry.status ?? '')
    && (entry.conclusion === null || typeof entry.conclusion === 'string')
    && Array.isArray(entry.feedbackRuns);
};

export const loadPublicSessions = (storage: Storage = getBrowserStorage()): PublicSessionHistory[] => {
  try {
    const raw = storage.getItem(PUBLIC_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPublicSessionHistory) : [];
  } catch {
    return [];
  }
};

export const appendPublicSession = (
  entry: PublicSessionHistory,
  storage: Storage = getBrowserStorage(),
): void => {
  try {
    const sessions = loadPublicSessions(storage)
      .filter((session) => session.id !== entry.id);
    storage.setItem(
      PUBLIC_HISTORY_STORAGE_KEY,
      JSON.stringify([entry, ...sessions].slice(0, MAX_PUBLIC_HISTORY_ENTRIES)),
    );
  } catch {
    // Browser storage can be disabled or full; the run itself must still succeed.
  }
};
