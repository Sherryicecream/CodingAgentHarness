import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSessionStore, SessionStore } from '../../src/loop/session-store.js';
import { Session } from '../../src/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function makeSession(id: string, task: string, status: Session['status'] = 'completed'): Session {
  return {
    id,
    createdAt: new Date(),
    task,
    messages: [],
    toolCalls: [],
    feedbackRuns: [],
    status,
    conclusion: null,
  };
}

describe('SessionStore', () => {
  let store: SessionStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `harness-test-sessions-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    store = createSessionStore(tmpDir);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Test 1: 保存并加载 → 数据一致
  describe('save and load', () => {
    it('should save and load a session with consistent data', async () => {
      const session = makeSession('session-1', 'Write a hello world');
      session.messages = [
        { role: 'user', content: 'Write a hello world' },
        { role: 'assistant', content: 'TASK_COMPLETE' },
      ];

      await store.save(session);
      const loaded = await store.load('session-1');

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('session-1');
      expect(loaded!.task).toBe('Write a hello world');
      expect(loaded!.messages).toHaveLength(2);
      expect(loaded!.messages[0].content).toBe('Write a hello world');
      expect(loaded!.messages[1].content).toBe('TASK_COMPLETE');
      expect(loaded!.status).toBe('completed');
    });

    it('should save session with tool calls and feedback runs', async () => {
      const session = makeSession('session-2', 'Run tests');
      session.toolCalls = [
        {
          timestamp: new Date(),
          toolName: 'write_file',
          params: { path: '/test.ts' },
          result: { success: true, output: 'File written' },
          guardrailCheck: 'passed',
        },
      ];
      session.feedbackRuns = [
        {
          iteration: 0,
          testResult: 'pass',
          failureCount: 0,
          fixApplied: false,
          timeSpent: 100,
        },
      ];

      await store.save(session);
      const loaded = await store.load('session-2');

      expect(loaded).not.toBeNull();
      expect(loaded!.toolCalls).toHaveLength(1);
      expect(loaded!.toolCalls[0].toolName).toBe('write_file');
      expect(loaded!.feedbackRuns).toHaveLength(1);
      expect(loaded!.feedbackRuns[0].testResult).toBe('pass');
    });
  });

  // Test 2: 列出所有会话 → 按时间排序
  describe('list', () => {
    it('should list sessions sorted by modification time (newest first)', async () => {
      const session1 = makeSession('s1', 'Task 1');
      const session2 = makeSession('s2', 'Task 2');
      const session3 = makeSession('s3', 'Task 3');

      await store.save(session1);
      // Small delay to ensure different mtime
      await new Promise(resolve => setTimeout(resolve, 50));
      await store.save(session2);
      await new Promise(resolve => setTimeout(resolve, 50));
      await store.save(session3);

      const sessions = await store.list();

      expect(sessions).toHaveLength(3);
      // Most recently saved should be first
      expect(sessions[0].id).toBe('s3');
      expect(sessions[1].id).toBe('s2');
      expect(sessions[2].id).toBe('s1');
    });

    it('should respect the limit parameter', async () => {
      for (let i = 1; i <= 5; i++) {
        const session = makeSession(`s${i}`, `Task ${i}`);
        await store.save(session);
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const sessions = await store.list(3);

      expect(sessions).toHaveLength(3);
    });

    it('should return empty array when no sessions exist', async () => {
      const sessions = await store.list();
      expect(sessions).toEqual([]);
    });
  });

  // Test 3: 删除会话 → 后续加载返回 null
  describe('delete', () => {
    it('should delete a session and return null on subsequent load', async () => {
      const session = makeSession('session-to-delete', 'Delete me');
      await store.save(session);

      // Verify it exists
      let loaded = await store.load('session-to-delete');
      expect(loaded).not.toBeNull();

      // Delete it
      await store.delete('session-to-delete');

      // Verify it's gone
      loaded = await store.load('session-to-delete');
      expect(loaded).toBeNull();
    });

    it('should not throw when deleting a non-existent session', async () => {
      await expect(store.delete('nonexistent-id')).resolves.toBeUndefined();
    });

    it('should remove session from list after deletion', async () => {
      const session1 = makeSession('keep', 'Keep me');
      const session2 = makeSession('remove', 'Remove me');

      await store.save(session1);
      await new Promise(resolve => setTimeout(resolve, 50));
      await store.save(session2);

      await store.delete('remove');

      const sessions = await store.list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('keep');
    });
  });

  // Test 4: 不存在的会话 → load 返回 null
  describe('load non-existent', () => {
    it('should return null when loading a session that does not exist', async () => {
      const loaded = await store.load('nonexistent-session-id');
      expect(loaded).toBeNull();
    });

    it('should return null for empty string id', async () => {
      const loaded = await store.load('');
      expect(loaded).toBeNull();
    });
  });

  // Test 5: Overwrite on save (idempotency)
  describe('save overwrite', () => {
    it('should overwrite existing session on save with same id', async () => {
      const session = makeSession('overwrite-test', 'Original task');
      await store.save(session);

      const updated = makeSession('overwrite-test', 'Updated task');
      updated.messages = [{ role: 'assistant', content: 'Updated result' }];
      await store.save(updated);

      const loaded = await store.load('overwrite-test');
      expect(loaded).not.toBeNull();
      expect(loaded!.task).toBe('Updated task');
      expect(loaded!.messages).toHaveLength(1);
      expect(loaded!.messages[0].content).toBe('Updated result');
    });
  });
});