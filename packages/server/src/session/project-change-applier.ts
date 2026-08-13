import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

interface ManifestArtifact { readonly relativePath: string; readonly size: number; readonly sha256: string }
interface ExportManifest { readonly sessionId: string; readonly artifacts: readonly ManifestArtifact[] }
export interface ProjectChangePreview {
  readonly approvalToken: string;
  readonly manifestDigest: string;
  readonly changes: readonly {
    readonly relativePath: string;
    readonly operation: 'create' | 'replace';
    readonly dangerous: boolean;
    readonly before?: string;
    readonly after?: string;
  }[];
}
export interface ProjectChangeApplier { preview(exportRoot: string): Promise<ProjectChangePreview>; apply(token: string): Promise<void> }

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const code = (error: unknown): string | undefined => typeof error === 'object' && error !== null && 'code' in error ? String(Reflect.get(error, 'code')) : undefined;
const safeRelative = (value: string): boolean => value.length > 0 && !isAbsolute(value) && !/^[a-z]:/i.test(value)
  && !value.split(/[\\/]/).some(segment => segment === '..' || segment.toLowerCase() === '.git');
const isManifestArtifact = (value: unknown): value is ManifestArtifact => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ManifestArtifact>;
  return typeof candidate.relativePath === 'string'
    && Number.isSafeInteger(candidate.size) && Number(candidate.size) >= 0
    && typeof candidate.sha256 === 'string' && /^[a-f0-9]{64}$/.test(candidate.sha256);
};

export const createProjectChangeApplier = ({ projectRoot }: { readonly projectRoot: string }): ProjectChangeApplier => {
  const canonicalProject = resolve(projectRoot);
  const approvals = new Map<string, { exportRoot: string; manifestDigest: string; manifest: ExportManifest }>();
  const load = async (exportRoot: string) => {
    const canonicalExport = resolve(exportRoot);
    const allowedExports = resolve(join(canonicalProject, '.harness', 'outputs'));
    if (!canonicalExport.startsWith(`${allowedExports}\\`) && !canonicalExport.startsWith(`${allowedExports}/`)) throw new Error('Export root is outside project outputs');
    const manifestBytes = await readFile(join(canonicalExport, 'manifest.json'));
    const candidate = JSON.parse(manifestBytes.toString('utf8')) as Partial<ExportManifest>;
    if (typeof candidate.sessionId !== 'string' || !Array.isArray(candidate.artifacts)
      || !candidate.artifacts.every(isManifestArtifact)) throw new Error('Invalid export manifest');
    const manifest: ExportManifest = {
      sessionId: candidate.sessionId,
      artifacts: candidate.artifacts,
    };
    return { canonicalExport, manifestBytes, manifest };
  };
  const verifyArtifact = async (exportRoot: string, artifact: ManifestArtifact): Promise<Buffer> => {
    if (!safeRelative(artifact.relativePath)) throw new Error('Unsafe artifact destination');
    const source = resolve(join(exportRoot, artifact.relativePath));
    if (!source.startsWith(`${exportRoot}\\`) && !source.startsWith(`${exportRoot}/`)) throw new Error('Artifact traversal rejected');
    const stats = await lstat(source);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Artifact source must be a regular file');
    const bytes = await readFile(source);
    if (bytes.byteLength !== artifact.size || digest(bytes) !== artifact.sha256) throw new Error('Artifact digest changed');
    return bytes;
  };
  return {
    async preview(exportRoot) {
      const loaded = await load(exportRoot);
      const changes: ProjectChangePreview['changes'][number][] = [];
      for (const artifact of loaded.manifest.artifacts) {
        const afterBytes = await verifyArtifact(loaded.canonicalExport, artifact);
        const destination = resolve(join(canonicalProject, artifact.relativePath));
        if (!destination.startsWith(`${canonicalProject}\\`) && !destination.startsWith(`${canonicalProject}/`)) throw new Error('Destination traversal rejected');
        let before: Buffer | undefined;
        try {
          const stats = await lstat(destination);
          if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Project destination is unsafe');
          before = await readFile(destination);
        } catch (error) { if (code(error) !== 'ENOENT') throw error; }
        changes.push(Object.freeze({
          relativePath: artifact.relativePath,
          operation: before ? 'replace' : 'create',
          dangerous: Boolean(before),
          before: before && before.byteLength < 64_000 ? before.toString('utf8') : undefined,
          after: afterBytes.byteLength < 64_000 ? afterBytes.toString('utf8') : undefined,
        }));
      }
      const approvalToken = randomUUID();
      const manifestDigest = digest(loaded.manifestBytes);
      approvals.set(approvalToken, { exportRoot: loaded.canonicalExport, manifestDigest, manifest: loaded.manifest });
      return Object.freeze({ approvalToken, manifestDigest, changes: Object.freeze(changes) });
    },
    async apply(token) {
      const approval = approvals.get(token);
      approvals.delete(token);
      if (!approval) throw new Error('Approval is absent, invalid, or already used');
      const loaded = await load(approval.exportRoot);
      if (digest(loaded.manifestBytes) !== approval.manifestDigest) throw new Error('Manifest changed after approval');
      for (const artifact of approval.manifest.artifacts) {
        await verifyArtifact(approval.exportRoot, artifact);
      }
      for (const artifact of approval.manifest.artifacts) {
        const destination = resolve(join(canonicalProject, artifact.relativePath));
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        const temporary = `${destination}.harness-apply-${randomUUID()}.tmp`;
        try {
          await copyFile(resolve(join(approval.exportRoot, artifact.relativePath)), temporary, constants.COPYFILE_EXCL);
          await rename(temporary, destination);
        } catch (error) {
          await rm(temporary, { force: true }).catch(() => undefined);
          throw error;
        }
      }
    },
  };
};
