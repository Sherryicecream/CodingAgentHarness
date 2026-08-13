import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const scanner = resolve('scripts/check-document-consistency.mjs');
const documentNames = [
  'README.md',
  'SPEC.md',
  'PLAN.md',
  'SPEC_PROCESS.md',
  'AGENT_LOG.md',
];

const createFixture = (overrides = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'harness-doc-check-'));
  for (const name of documentNames) {
    writeFileSync(
      join(root, name),
      overrides[name] ?? `# ${name}\n本地可信交付；公开模式仅为确定性演示。\n`,
      'utf8',
    );
  }
  return root;
};

test('rejects controlled documents containing every prohibited claim class', () => {
  const root = createFixture({
    'README.md': '# README\n公开 WebUI 支持 BYOK API Key 并运行完整产品。\n',
    'SPEC.md': [
      '# SPEC',
      '项目已部署到阿里云 ECS，浏览器打开即用。',
      '访问 http://47.98.97.255:3000 或 https://harness.onrender.com。',
      '数据库驱动为 better-sqlite3。',
    ].join('\n'),
    'PLAN.md': '# PLAN\nStatus: ALL PHASES COMPLETE\nTask 8 | pending\n',
    'SPEC_PROCESS.md': '# PROCESS\nTODO: replace this placeholder; deployment is TBD.\n',
    'AGENT_LOG.md': '# LOG\n锟斤拷 stale mojibake\n',
  });

  try {
    const result = spawnSync(process.execPath, [scanner, '--root', root], {
      encoding: 'utf8',
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.notEqual(result.status, 0, 'stale controlled documents must fail');
    for (const code of [
      'STALE_CLOUD_PRODUCT',
      'UNVERIFIED_PUBLIC_URL',
      'PUBLIC_BYOK',
      'STALE_DATABASE_DRIVER',
      'CONTRADICTORY_STATUS',
      'PLACEHOLDER',
      'MOJIBAKE',
    ]) {
      assert.match(output, new RegExp(`\\[${code}\\]`));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('accepts a controlled local-delivery documentation set', () => {
  const root = createFixture();

  try {
    const output = execFileSync(process.execPath, [scanner, '--root', root], {
      encoding: 'utf8',
    });
    assert.match(output, /Documentation consistency check passed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a public full-product claim even when it mentions no credentials', () => {
  const root = createFixture({
    'README.md': '# README\n公开 WebUI 运行完整产品，浏览器打开即用。\n',
  });

  try {
    const result = spawnSync(process.execPath, [scanner, '--root', root], {
      encoding: 'utf8',
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.notEqual(result.status, 0, 'a public full-product claim must fail');
    assert.match(output, /\[PUBLIC_FULL_PRODUCT\]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const isolatedViolations = [
  ['STALE_CLOUD_PRODUCT', 'README.md', '项目部署在 Alibaba Cloud。'],
  ['UNVERIFIED_PUBLIC_URL', 'SPEC.md', 'Complete product: https://harness.example.com'],
  ['PUBLIC_BYOK', 'README.md', 'Public mode supports\nBYOK API keys.'],
  ['STALE_DATABASE_DRIVER', 'SPEC.md', 'Database: better-sqlite3'],
  ['PLACEHOLDER', 'SPEC_PROCESS.md', 'TBD'],
  ['MOJIBAKE', 'AGENT_LOG.md', '锟斤拷'],
];

for (const [code, name, staleText] of isolatedViolations) {
  test(`rejects isolated ${code} documents`, () => {
    const root = createFixture({ [name]: `# ${name}\n${staleText}\n` });

    try {
      const result = spawnSync(process.execPath, [scanner, '--root', root], {
        encoding: 'utf8',
      });
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(`\\[${code}\\]`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('rejects generic complete and pending status contradiction', () => {
  const root = createFixture({
    'PLAN.md': '# PLAN\nStatus: complete\nTask 6 status: pending\n',
  });

  try {
    const result = spawnSync(process.execPath, [scanner, '--root', root], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /\[CONTRADICTORY_STATUS\]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
