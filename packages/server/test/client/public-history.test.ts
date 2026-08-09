import { describe, expect, it } from 'vitest';
import {
  appendPublicSession,
  loadPublicSessions,
  type PublicSessionHistory,
} from '../../client/src/history/public-history.js';

const createStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
};

const entry: PublicSessionHistory = {
  id: 'public-session-1',
  createdAt: '2026-08-09T00:00:00.000Z',
  task: '创建一个示例文件',
  status: 'completed',
  conclusion: '任务完成',
  feedbackRuns: [{
    iteration: 0,
    testResult: 'pass',
    failureCount: 0,
    fixApplied: false,
    timeSpent: 0,
  }],
};

describe('public browser session history', () => {
  it('stores and loads the current browser user history', () => {
    const storage = createStorage();

    appendPublicSession(entry, storage);

    expect(loadPublicSessions(storage)).toEqual([entry]);
  });

  it('ignores malformed stored history instead of throwing', () => {
    const storage = createStorage();
    storage.setItem('harness.public.session-history.v1', '{bad');

    expect(loadPublicSessions(storage)).toEqual([]);
  });
});
