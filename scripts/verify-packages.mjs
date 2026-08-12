import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const packageDirectories = ['core', 'server', 'cli'];
const packCommand = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
const packArguments = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm.cmd pack --dry-run --json --ignore-scripts']
  : ['pack', '--dry-run', '--json', '--ignore-scripts'];

const collectLocalEntries = (value, entries) => {
  if (typeof value === 'string') {
    if (value.startsWith('./')) entries.add(value.slice(2));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const nestedValue of Object.values(value)) {
    collectLocalEntries(nestedValue, entries);
  }
};

const expectedEntries = (packageJson) => {
  const entries = new Set();
  for (const field of ['main', 'types', 'bin', 'exports']) {
    collectLocalEntries(packageJson[field], entries);
  }
  return entries;
};

const cacheDirectory = mkdtempSync(join(tmpdir(), 'harness-pack-check-'));

try {
  for (const packageDirectory of packageDirectories) {
    const directory = join(repositoryRoot, 'packages', packageDirectory);
    const packageJson = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const result = spawnSync(
      packCommand,
      packArguments,
      {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, npm_config_cache: cacheDirectory },
      },
    );

    if (result.status !== 0) {
      throw new Error(`npm pack --dry-run failed for ${packageJson.name}\n${result.stderr}`);
    }

    const [manifest] = JSON.parse(result.stdout);
    const packedFiles = new Set(manifest.files.map(({ path }) => path));
    const missingEntries = [...expectedEntries(packageJson)]
      .filter((entry) => !packedFiles.has(entry));

    if (missingEntries.length > 0) {
      throw new Error(`${packageJson.name} is missing packed entries: ${missingEntries.join(', ')}`);
    }

    console.log(`${packageJson.name}: ${manifest.files.length} files; package entries verified`);
  }
} finally {
  rmSync(cacheDirectory, { recursive: true, force: true });
}
