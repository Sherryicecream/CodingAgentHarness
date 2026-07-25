import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryStore, MemoryStore } from '../../src/memory/memory-store.js';
import { MemoryEntry } from '../../src/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('MemoryStore', () => {
  let store: MemoryStore;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `test-memory-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    store = await createMemoryStore(dbPath);
  });

  afterEach(() => {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  describe('add', () => {
    it('should write and read a memory entry — content matches', async () => {
      const entry = await store.add({
        type: 'convention',
        content: 'Use camelCase for variable names',
        source: 'code-review',
        projectPath: '/project/a',
      });

      expect(entry.id).toBeDefined();
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.type).toBe('convention');
      expect(entry.content).toBe('Use camelCase for variable names');
      expect(entry.source).toBe('code-review');
      expect(entry.createdAt).toBeInstanceOf(Date);
      expect(entry.lastAccessedAt).toBeInstanceOf(Date);

      // Verify we can retrieve it via list
      const entries = await store.list('/project/a');
      expect(entries).toHaveLength(1);
      expect(entries[0].content).toBe('Use camelCase for variable names');
    });
  });

  describe('search', () => {
    it('should return matching results via keyword search', async () => {
      await store.add({
        type: 'convention',
        content: 'Use camelCase for variable names',
        source: 'code-review',
        projectPath: '/project/a',
      });
      await store.add({
        type: 'decision',
        content: 'Use TypeScript strict mode',
        source: 'team-meeting',
        projectPath: '/project/a',
      });
      await store.add({
        type: 'knowledge',
        content: 'API keys are in .env file',
        source: 'readme',
        projectPath: '/project/a',
      });

      const results = await store.search('camelCase');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.content.includes('camelCase'))).toBe(true);
    });

    it('should filter by type when option provided', async () => {
      await store.add({
        type: 'convention',
        content: 'Use camelCase',
        source: 'code-review',
        projectPath: '/project/a',
      });
      await store.add({
        type: 'decision',
        content: 'Use TypeScript',
        source: 'team-meeting',
        projectPath: '/project/a',
      });

      const results = await store.search('Use', { type: 'convention' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (const r of results) {
        expect(r.type).toBe('convention');
      }
    });

    it('should update lastAccessedAt on search', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

      const entry = await store.add({
        type: 'convention',
        content: 'Use camelCase',
        source: 'code-review',
        projectPath: '/project/a',
      });

      expect(entry.lastAccessedAt.getTime()).toBe(new Date('2024-01-01T00:00:00.000Z').getTime());

      // Advance time by 2 seconds
      vi.setSystemTime(new Date('2024-01-01T00:00:02.000Z'));

      const results = await store.search('camelCase');
      expect(results.length).toBeGreaterThanOrEqual(1);
      const updated = results.find(r => r.id === entry.id);
      expect(updated).toBeDefined();
      expect(updated!.lastAccessedAt.getTime()).toBe(new Date('2024-01-01T00:00:02.000Z').getTime());

      vi.useRealTimers();
    });
  });

  describe('list', () => {
    it('should isolate memories by project', async () => {
      await store.add({
        type: 'convention',
        content: 'Project A rule',
        source: 'dev',
        projectPath: '/project/a',
      });
      await store.add({
        type: 'convention',
        content: 'Project B rule',
        source: 'dev',
        projectPath: '/project/b',
      });

      const entriesA = await store.list('/project/a');
      const entriesB = await store.list('/project/b');

      expect(entriesA).toHaveLength(1);
      expect(entriesA[0].content).toBe('Project A rule');
      expect(entriesB).toHaveLength(1);
      expect(entriesB[0].content).toBe('Project B rule');
    });
  });

  describe('getByType', () => {
    it('should filter by type', async () => {
      await store.add({
        type: 'convention',
        content: 'Convention entry',
        source: 'dev',
        projectPath: '/project/a',
      });
      await store.add({
        type: 'decision',
        content: 'Decision entry',
        source: 'dev',
        projectPath: '/project/a',
      });
      await store.add({
        type: 'knowledge',
        content: 'Knowledge entry',
        source: 'dev',
        projectPath: '/project/a',
      });

      const conventions = await store.getByType('/project/a', 'convention');
      expect(conventions).toHaveLength(1);
      expect(conventions[0].type).toBe('convention');
      expect(conventions[0].content).toBe('Convention entry');

      const decisions = await store.getByType('/project/a', 'decision');
      expect(decisions).toHaveLength(1);
      expect(decisions[0].type).toBe('decision');

      // Empty project should return empty
      const empty = await store.getByType('/project/nonexistent', 'convention');
      expect(empty).toHaveLength(0);
    });
  });

  describe('delete', () => {
    it('should remove an entry so subsequent queries do not include it', async () => {
      const entry = await store.add({
        type: 'convention',
        content: 'To be deleted',
        source: 'dev',
        projectPath: '/project/a',
      });

      const before = await store.list('/project/a');
      expect(before).toHaveLength(1);

      await store.delete(entry.id);

      const after = await store.list('/project/a');
      expect(after).toHaveLength(0);
    });
  });
});