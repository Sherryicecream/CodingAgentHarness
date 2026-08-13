import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProjectChangeApplier } from '../../src/session/project-change-applier.js';

const fixture = async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'harness-apply-'));
  const exportRoot = join(projectRoot, '.harness', 'outputs', 'session-1');
  await mkdir(exportRoot, { recursive: true });
  await writeFile(join(exportRoot, 'new.txt'), 'new');
  await writeFile(join(exportRoot, 'existing.txt'), 'replacement');
  const artifacts = [
    { relativePath: 'new.txt', size: 3, sha256: '11507a0e2f5e69d5dfa40a62a1bd7b6ee57e6bcd85c67c9b8431b36fff21c437' },
    { relativePath: 'existing.txt', size: 11, sha256: '95713e9cbdd1dfcb2d4080c2537f418d43ca0da25f0d7d6631f4f7c97b89dc47' },
  ];
  await writeFile(join(exportRoot, 'manifest.json'), JSON.stringify({ sessionId: 'session-1', artifacts }));
  await writeFile(join(projectRoot, 'existing.txt'), 'old');
  return { projectRoot, exportRoot };
};

describe('project change applier', () => {
  it('previews creations and dangerous replacements without writing', async () => {
    const { projectRoot, exportRoot } = await fixture();
    const preview = await createProjectChangeApplier({ projectRoot }).preview(exportRoot);
    expect(preview.changes).toEqual([
      expect.objectContaining({ relativePath: 'new.txt', operation: 'create', dangerous: false }),
      expect.objectContaining({ relativePath: 'existing.txt', operation: 'replace', dangerous: true }),
    ]);
    await expect(readFile(join(projectRoot, 'new.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('binds a single-use approval to the manifest digest and destination set', async () => {
    const { projectRoot, exportRoot } = await fixture();
    const applier = createProjectChangeApplier({ projectRoot });
    const preview = await applier.preview(exportRoot);
    await applier.apply(preview.approvalToken);
    expect(await readFile(join(projectRoot, 'existing.txt'), 'utf8')).toBe('replacement');
    await expect(applier.apply(preview.approvalToken)).rejects.toThrow(/approval/i);
  });

  it('invalidates approval when an exported artifact changes', async () => {
    const { projectRoot, exportRoot } = await fixture();
    const applier = createProjectChangeApplier({ projectRoot });
    const preview = await applier.preview(exportRoot);
    await writeFile(join(exportRoot, 'new.txt'), 'tampered');
    await expect(applier.apply(preview.approvalToken)).rejects.toThrow(/changed|digest/i);
  });
});
