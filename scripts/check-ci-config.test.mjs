import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..');

const readConfig = (path) => readFile(resolve(repositoryRoot, path), 'utf8');

const assertCommandsInOrder = (config, commands, label) => {
  let previousIndex = -1;
  for (const command of commands) {
    const index = config.indexOf(command);
    assert.ok(index > previousIndex, `${label} must run ${command} in order`);
    previousIndex = index;
  }
};

test('GitHub CI preserves triggers and verifies tests, builds, and packages', async () => {
  const config = await readConfig('.github/workflows/ci.yml');

  assert.match(config, /^\s{2}push:\s*\r?\n\s{4}branches: \[master, main, codex\/\*\]$/m);
  assert.match(config, /^\s{2}pull_request:\s*\r?\n\s{4}branches: \[master, main\]$/m);
  assert.match(config, /^\s{2}unit-test:\s*$/m);
  assertCommandsInOrder(
    config,
    ['npm ci', 'npm test', 'npm run build', 'npm run verify:packages'],
    'GitHub CI',
  );
  assert.match(
    config,
    /^\s{4}if: .*github\.ref == 'refs\/heads\/master'.*$/m,
    'GitHub Pages deployment must run from the repository default branch',
  );
  assert.doesNotMatch(config, /npm publish|secrets\.|\brelease\b/i);
});

test('GitLab CI preserves unit tests and verifies builds and packages', async () => {
  const config = await readConfig('.gitlab-ci.yml');

  assert.match(config, /^unit-test:\s*$/m);
  assertCommandsInOrder(
    config,
    ['npm ci', 'npm test', 'npm run build', 'npm run verify:packages'],
    'GitLab CI',
  );
  assert.doesNotMatch(config, /npm publish|\brelease\b/i);
});
