import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { ArtifactRecord } from './artifact-tracker.js';

export interface ExportArtifactsOptions {
  readonly sessionId: string;
  readonly workspace: string;
  readonly projectRoot: string;
  readonly artifacts: readonly ArtifactRecord[];
}

export interface ArtifactExportResult {
  readonly destination: string;
  readonly manifest: { readonly sessionId: string; readonly artifacts: readonly ArtifactRecord[] };
}

const errorCode = (error: unknown): string | undefined => (
  typeof error === 'object' && error !== null && 'code' in error ? String(Reflect.get(error, 'code')) : undefined
);

export const exportArtifacts = async (options: ExportArtifactsOptions): Promise<ArtifactExportResult> => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(options.sessionId)) throw new Error('Invalid session id');
  if (!isAbsolute(options.workspace) || !isAbsolute(options.projectRoot)) throw new Error('Export roots must be absolute');
  const outputs = resolve(join(options.projectRoot, '.harness', 'outputs'));
  const destination = resolve(join(outputs, options.sessionId));
  const staging = resolve(join(outputs, `.staging-${options.sessionId}-${randomUUID()}`));
  await mkdir(outputs, { recursive: true, mode: 0o700 });
  try {
    await lstat(destination);
    throw new Error('Completed artifact export already exists');
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  const manifest = Object.freeze({ sessionId: options.sessionId, artifacts: options.artifacts });
  await mkdir(staging, { mode: 0o700 });
  try {
    for (const artifact of options.artifacts) {
      const source = resolve(join(options.workspace, artifact.relativePath));
      const target = resolve(join(staging, artifact.relativePath));
      if (!source.startsWith(resolve(options.workspace) + '\\') && !source.startsWith(resolve(options.workspace) + '/')) throw new Error('Artifact traversal rejected');
      if (!target.startsWith(staging + '\\') && !target.startsWith(staging + '/')) throw new Error('Artifact traversal rejected');
      const stats = await lstat(source);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Artifact source must be a regular file');
      const bytes = await readFile(source);
      if (bytes.byteLength !== artifact.size || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
        throw new Error('Artifact digest mismatch');
      }
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(source, target, constants.COPYFILE_EXCL);
    }
    await writeFile(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(staging, destination);
    return { destination, manifest };
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
};
