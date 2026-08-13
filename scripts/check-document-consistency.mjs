#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const documentNames = [
  'README.md',
  'SPEC.md',
  'PLAN.md',
  'SPEC_PROCESS.md',
  'AGENT_LOG.md',
];

const rootIndex = process.argv.indexOf('--root');
const root = resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : process.cwd());
const findings = [];

const report = (code, file, line, message) => {
  findings.push({ code, file: basename(file), line, message });
};

const documents = documentNames.map((name) => {
  const file = join(root, name);
  try {
    return { name, file, text: readFileSync(file, 'utf8') };
  } catch (error) {
    report('MISSING_DOCUMENT', file, 0, error.message);
    return { name, file, text: '' };
  }
});

for (const document of documents) {
  const lines = document.text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (/阿里云|Alibaba\s+Cloud|\bECS\b|云服务器|线上部署|Web\s*线上部署/i.test(line)) {
      report('STALE_CLOUD_PRODUCT', document.file, lineNumber, 'unverified cloud/full-product claim');
    }
    const urls = line.match(/https?:\/\/[^\s)`>]+/gi) ?? [];
    for (const value of urls) {
      const hostname = new URL(value).hostname.toLowerCase();
      if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
        report('UNVERIFIED_PUBLIC_URL', document.file, lineNumber, `unverified public endpoint: ${value}`);
      }
    }
    if (/better-sqlite3/i.test(line)) {
      report('STALE_DATABASE_DRIVER', document.file, lineNumber, 'the implementation uses sql.js');
    }
    if (/\b(?:TODO|TBD|placeholder)\b/i.test(line)) {
      report('PLACEHOLDER', document.file, lineNumber, 'unresolved placeholder');
    }
    if (/\uFFFD|锟斤拷|(?:鈥|鈻|绔\?|褰撳|鎴愬姛)/u.test(line)) {
      report('MOJIBAKE', document.file, lineNumber, 'garbled or replacement text');
    }

  });

  const paragraphs = document.text.split(/(?:\r?\n){2,}|\r?\n(?=\s*[-*]\s)/);
  let offset = 0;
  for (const paragraph of paragraphs) {
    const lineNumber = document.text.slice(0, offset).split(/\r?\n/).length;
    const publicContext = /public|公开|公网/i.test(paragraph);
    const fullProductClaim = /完整(?:产品|功能|版本)|full[- ]product|browser open and use|浏览器打开即用/i.test(paragraph);
    const credentialContext = /BYOK|API\s*Key|凭据/i.test(paragraph);
    const enablingClaim = /支持|启用|可用|接收|存储|使用|完整产品|full product|enabled|supports?|accept|store|use/i.test(paragraph);
    const explicitDenial = /不(?:支持|启用|可用|接收|存储|使用|运行)|仅(?:为|用于|提供|展示)|禁用|拒绝|never|not|disabled|deterministic demo only/i.test(paragraph);
    if (publicContext && credentialContext && enablingClaim && !explicitDenial) {
      report('PUBLIC_BYOK', document.file, lineNumber, 'public mode must not offer credentials');
    }
    if (publicContext && fullProductClaim && !explicitDenial) {
      report('PUBLIC_FULL_PRODUCT', document.file, lineNumber, 'public mode is deterministic demo only');
    }
    offset += paragraph.length + (document.text.slice(offset + paragraph.length).match(/^(?:\r?\n){2,}/)?.[0].length ?? 0);
  }
}

const corpus = documents.map(({ text }) => text).join('\n');
if (/\bcomplete(?:d)?\b|全部完成|所有阶段完成/i.test(corpus) && /\bpending\b|待完成/i.test(corpus)) {
  report('CONTRADICTORY_STATUS', join(root, 'PLAN.md'), 0, 'complete and pending statuses coexist');
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`[${finding.code}] ${finding.file}:${finding.line} ${finding.message}`);
  }
  console.error(`Documentation consistency check failed: ${findings.length} finding(s).`);
  process.exitCode = 1;
} else {
  console.log(`Documentation consistency check passed: ${documentNames.length} files.`);
}
