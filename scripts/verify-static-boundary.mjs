import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = new URL('../packages/server/dist/static-demo/', import.meta.url);
const files = await readdir(root, { recursive: true });
const rootPath = fileURLToPath(root);
const indexFile = 'index.html';
if (!files.includes(indexFile)) {
  throw new Error('Static demo artifact is missing the GitHub Pages index.html entry.');
}
if (files.includes('static-demo.html')) {
  throw new Error('Static demo artifact still exposes static-demo.html instead of index.html.');
}

const indexHtml = await readFile(join(rootPath, indexFile), 'utf8');
const assetReferences = [...indexHtml.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+)(?:[?#][^"]*)?"/g)]
  .map(match => match[1].slice(2));
if (assetReferences.length === 0) {
  throw new Error('Static demo index.html has no relative generated asset references.');
}
for (const assetReference of assetReferences) {
  try {
    await access(join(rootPath, assetReference));
  } catch {
    throw new Error(`Static demo index.html references a missing asset: ${assetReference}`);
  }
}

const text = (await Promise.all(files.filter(file => file.endsWith('.js')).map(file => readFile(join(rootPath, file), 'utf8')))).join('\n');
for (const forbidden of ['@napi-rs/keyring','child_process','express','DEEPSEEK_API_KEY','/api/agent','write_file']) {
  if (text.includes(forbidden)) throw new Error(`Static boundary contains forbidden dependency marker: ${forbidden}`);
}
console.log('Static demo boundary verified.');
