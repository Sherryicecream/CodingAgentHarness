import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = new URL('../packages/server/dist/static-demo/', import.meta.url);
const files = await readdir(root, { recursive: true });
const rootPath = fileURLToPath(root);
const text = (await Promise.all(files.filter(file => file.endsWith('.js')).map(file => readFile(join(rootPath, file), 'utf8')))).join('\n');
for (const forbidden of ['@napi-rs/keyring','child_process','express','DEEPSEEK_API_KEY','/api/agent','write_file']) {
  if (text.includes(forbidden)) throw new Error(`Static boundary contains forbidden dependency marker: ${forbidden}`);
}
console.log('Static demo boundary verified.');
