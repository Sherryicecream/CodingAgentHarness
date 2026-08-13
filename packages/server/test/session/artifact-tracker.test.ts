import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createArtifactTracker } from '../../src/session/artifact-tracker.js';

describe('artifact tracker', () => {
  it('records immutable artifact metadata without exposing an absolute path', () => {
    const tracker = createArtifactTracker({ now: () => new Date('2026-08-13T04:00:00.000Z') });
    tracker.record({ relativePath: 'src/result.ts', content: Buffer.from('first'), toolCallId: 'call-1' });

    const [artifact] = tracker.list();
    expect(artifact).toEqual({
      relativePath: 'src/result.ts',
      operation: 'created',
      size: 5,
      sha256: createHash('sha256').update('first').digest('hex'),
      timestamp: '2026-08-13T04:00:00.000Z',
      toolCallId: 'call-1',
    });
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(() => { (artifact as { size: number }).size = 0; }).toThrow();
  });

  it('collapses repeated writes to the latest digest while retaining created semantics', () => {
    let time = '2026-08-13T04:00:00.000Z';
    const tracker = createArtifactTracker({ now: () => new Date(time) });
    tracker.record({ relativePath: 'result.txt', content: Buffer.from('one'), toolCallId: 'call-1' });
    time = '2026-08-13T04:01:00.000Z';
    tracker.record({ relativePath: 'result.txt', content: Buffer.from('two!'), toolCallId: 'call-2' });

    expect(tracker.list()).toHaveLength(1);
    expect(tracker.list()[0]).toMatchObject({
      relativePath: 'result.txt', operation: 'created', size: 4, toolCallId: 'call-2',
      timestamp: '2026-08-13T04:01:00.000Z',
    });
  });

  it('rejects paths that are not normalized workspace-relative paths', () => {
    const tracker = createArtifactTracker();
    for (const relativePath of ['../secret', '/absolute', 'C:\\absolute', '.git/config']) {
      expect(() => tracker.record({ relativePath, content: Buffer.alloc(0), toolCallId: 'call' })).toThrow();
    }
  });
});
