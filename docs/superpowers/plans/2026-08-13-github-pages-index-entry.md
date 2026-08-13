# GitHub Pages Root Entry Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deployed static demo open successfully at the GitHub Pages repository root URL by producing `dist/static-demo/index.html`.

**Architecture:** Keep `client/static-demo.html` as the static-only source entry and add a Vite plugin used only by `vite.static.config.ts` to rename the emitted HTML asset to `index.html`. Strengthen the existing static-boundary verifier so CI fails when the Pages entry is missing or its relative asset references do not resolve.

**Tech Stack:** Node.js 22, TypeScript, Vite 8, Rollup output bundle hooks, GitHub Actions Pages.

## Global Constraints

- Change only the static-demo build contract; do not change the local full WebUI entry or Express server.
- Keep all generated JavaScript and CSS references relative so the repository subpath works.
- Do not add server runtime code, API keys, credentials, session data, or workspace data to the static artifact.
- Do not create a GitHub Release until the Pages root URL returns HTTP 200.
- Keep `packages/server/safe-example.ts` untracked and outside every commit.

## File Structure

- Modify `scripts/verify-static-boundary.mjs`: enforce the Pages-compatible HTML entry and validate its generated asset references.
- Modify `packages/server/client/vite.static.config.ts`: rename the one emitted static HTML asset inside the Vite/Rollup bundle.
- Modify `AI4SE_DELIVERY_CHECKLIST.md` and `PLAN.md` only after remote deployment is proven accessible.

---

### Task 1: Enforce and Produce the Pages Root Entry

**Files:**
- Modify: `scripts/verify-static-boundary.mjs`
- Modify: `packages/server/client/vite.static.config.ts`

**Interfaces:**
- Consumes: Vite's `Plugin` type and Rollup `generateBundle` output bundle.
- Produces: `packages/server/dist/static-demo/index.html` with valid `./assets/...` references.
- Produces: a verifier process that exits nonzero if `index.html` is absent, `static-demo.html` remains, or a referenced generated asset is absent.

- [x] **Step 1: Add the failing artifact-contract assertions**

Update `scripts/verify-static-boundary.mjs` before changing Vite:

```js
import { access, readFile, readdir } from 'node:fs/promises';

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
```

- [x] **Step 2: Verify RED against the current build**

Run:

```powershell
npm.cmd run build:static-demo
npm.cmd run verify:static-boundary
```

Expected: the build succeeds, then verification fails only with `Static demo artifact is missing the GitHub Pages index.html entry.` The generated directory contains `static-demo.html` and no `index.html`.

- [x] **Step 3: Add the minimal static-only Vite plugin**

Update `packages/server/client/vite.static.config.ts`:

```ts
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const pagesIndexEntry = (): Plugin => ({
  name: 'pages-index-entry',
  generateBundle: {
    order: 'post',
    handler(_options, bundle) {
      const sourceName = 'static-demo.html';
      const page = bundle[sourceName];
      if (!page || page.type !== 'asset') {
        this.error(`Expected Vite to emit ${sourceName}.`);
      }

      page.fileName = 'index.html';
    },
  },
});

export default defineConfig({
  plugins: [react(), pagesIndexEntry()],
  root: '.',
  base: './',
  build: {
    outDir: '../dist/static-demo',
    rollupOptions: { input: resolve(import.meta.dirname, 'static-demo.html') },
  },
});
```

- [x] **Step 4: Verify focused GREEN**

Run:

```powershell
npm.cmd run build:static-demo
npm.cmd run verify:static-boundary
Test-Path packages/server/dist/static-demo/index.html
Test-Path packages/server/dist/static-demo/static-demo.html
```

Expected: build and verifier pass; the two path checks print `True` and `False` respectively.

- [x] **Step 5: Run regression verification**

Run:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run build:static-demo
npm.cmd run verify:static-boundary
npm.cmd run test:docs
npm.cmd run check:docs
```

Expected: every command exits 0. Confirm no process is listening in the test port range 31000–31999 after completion.

- [x] **Step 6: Review and request commit approval**

Review only these intended implementation paths plus this plan:

```powershell
git diff -- scripts/verify-static-boundary.mjs packages/server/client/vite.static.config.ts docs/superpowers/plans/2026-08-13-github-pages-index-entry.md
git status --short
```

Expected: `packages/server/safe-example.ts` remains untracked and is not staged. After human approval, create one atomic fix commit; do not push yet.

---

### Task 2: Prove the Public Root URL and Close Delivery Evidence

**Files:**
- Modify after remote success: `AI4SE_DELIVERY_CHECKLIST.md`
- Modify after remote success: `PLAN.md`

**Interfaces:**
- Consumes: the pushed fix commit and GitHub Actions Pages deployment output.
- Produces: a public root URL returning the static Harness demo and truthful final-delivery status documentation.

- [x] **Step 1: Request push approval and push the fix**

After explicit human approval, push the local commits to `origin/master`. Do not create a Release in this step.

- [x] **Step 2: Verify both remote jobs**

Open the workflow run associated with the fix commit and verify separately:

- `unit-test`: success;
- `deploy-static-demo`: success;
- total workflow conclusion: success.

- [x] **Step 3: Verify the deployed page contract**

Request `https://sherryicecream.github.io/CodingAgentHarness/` and require:

- HTTP 200;
- title `Harness 机制演示`;
- element `id="root"`;
- relative `/CodingAgentHarness/assets/` or `./assets/` resource references;
- referenced JavaScript and CSS URLs each return HTTP 200.

- [x] **Step 4: Update delivery evidence only after Step 3 passes**

In `AI4SE_DELIVERY_CHECKLIST.md` and `PLAN.md`, replace the pending Pages wording with the exact successful workflow run and verified root URL. Do not claim that the static demo exposes the local API, credentials, or full product.

- [x] **Step 5: Verify, review, and request documentation commit approval**

Run:

```powershell
npm.cmd run test:docs
npm.cmd run check:docs
git diff --check
git status --short
```

Expected: both documentation commands pass, no whitespace errors occur, and only the two delivery documents plus the intentionally untracked `safe-example.ts` remain. Request human approval before committing or pushing the evidence update.

Release packaging and release-asset URL updates are the next separate task after this plan is completely green.
