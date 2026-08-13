import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArtifactTracker } from '../../src/session/artifact-tracker.js';
import { exportArtifacts } from '../../src/session/artifact-exporter.js';

describe('artifact exporter', () => {
  it('exports nested files and a verified manifest to a session directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-export-'));
    const workspace = join(root, 'workspace');
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(join(workspace, 'src', 'answer.txt'), 'answer');
    const tracker = createArtifactTracker();
    tracker.record({ relativePath: 'src/answer.txt', content: Buffer.from('answer'), toolCallId: 'call-1' });

    const result = await exportArtifacts({ sessionId: 'session-1', workspace, projectRoot: root, artifacts: tracker.list() });
    expect(await readFile(join(result.destination, 'src', 'answer.txt'), 'utf8')).toBe('answer');
    expect(JSON.parse(await readFile(join(result.destination, 'manifest.json'), 'utf8')).artifacts).toEqual(tracker.list());
  });

  it('rejects changed content, symbolic links, and an existing completed export', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-export-'));
    const workspace = join(root, 'workspace');
    await mkdir(workspace);
    await writeFile(join(workspace, 'changed.txt'), 'changed');
    const tracker = createArtifactTracker();
    tracker.record({ relativePath: 'changed.txt', content: Buffer.from('original'), toolCallId: 'call' });
    await expect(exportArtifacts({ sessionId: 'digest', workspace, projectRoot: root, artifacts: tracker.list() })).rejects.toThrow(/digest/i);

    await writeFile(join(workspace, 'target.txt'), 'target');
    try {
      await symlink(join(workspace, 'target.txt'), join(workspace, 'link.txt'));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EPERM')) throw error;
      return;
    }
    const links = createArtifactTracker();
    links.record({ relativePath: 'link.txt', content: Buffer.from('target'), toolCallId: 'call' });
    await expect(exportArtifacts({ sessionId: 'link', workspace, projectRoot: root, artifacts: links.list() })).rejects.toThrow(/regular file/i);
  });
});
