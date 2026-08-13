# Windows CLI Cleanup Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Windows CLI lifecycle regression clean its detached fixture deterministically and keep packed-tarball installation stable without weakening product assertions.

**Architecture:** Keep the existing production-behavior test unchanged through its expected cleanup failure, then terminate only the fixture Server's recorded PID with Node's cross-platform process API in `finally`. For the later packed-install timeout, retain a fresh install directory but reuse npm's integrity-checked default cache instead of forcing each run to download 92 packages into a new empty cache.

**Tech Stack:** Node.js 22/24 test runner, `node:child_process`, `process.kill`, loopback HTTP polling.

---

### Task 1: Deterministic fixture cleanup

**Files:**
- Modify: `packages/cli/test/installed-runtime.test.mjs:123-169`
- Test: `packages/cli/test/installed-runtime.test.mjs`

- [x] **Step 1: Verify RED**

Run in ordinary Windows PowerShell:

```powershell
npm.cmd test --workspace @harness/cli
```

Observed: 2/4 passed; cleanup test failed because port 31109 remained open, and PID 43812 was confirmed as the detached fixture Server.

- [x] **Step 2: Implement minimal fixture termination**

Replace the fixture's direct `taskkill` call with an exact-PID helper using `process.kill(pid, 'SIGKILL')`; ignore only `ESRCH`, and retain `waitForPortToClose(url)` as the behavioral assertion.

- [x] **Step 3: Verify focused GREEN**

```powershell
node --test --test-name-pattern="Windows cleanup reports" test/installed-runtime.test.mjs
```

Expected: 1/1 passed and no listener remains on the selected port.

- [x] **Step 4: Verify complete CLI suite**

```powershell
npm.cmd test --workspace @harness/cli
```

Expected: 4/4 passed. If packed CLI still fails, stop and gather new stage timing instead of increasing timeouts blindly.

### Task 2: Delivery evidence

**Files:**
- Modify after GREEN: `README.md`
- Modify after GREEN: `PLAN.md`
- Modify after GREEN: `AI4SE_DELIVERY_CHECKLIST.md`

- [x] **Step 1: Update evidence only after current 4/4 GREEN**

Record the fresh Windows result and remove the current unresolved-gap wording.

- [x] **Step 2: Run regression checks**

```powershell
npm.cmd run typecheck
npm.cmd run verify:packages
npm.cmd run check:docs
npm.cmd run test:docs
git diff --check
```

Expected: every command exits 0.

- [x] **Step 3: Request integration approval**

Do not stage, commit or push until the user reviews the result and approves the next action.

### Task 3: Packed-install cache stability

**Files:**
- Modify: `packages/cli/test/installed-runtime.test.mjs:207-212`
- Test: `packages/cli/test/installed-runtime.test.mjs`

**Interfaces:**
- Consumes: npm's normal content-addressed cache, populated by the repository dependency installation.
- Produces: the same fresh temporary install tree and the same packaged CLI health/WebUI assertions without a forced empty-cache network download.

- [x] **Step 1: Verify RED and isolate the cause**

The focused packed test failed twice: once when its internal `npm install` returned `status: null` after the 50-second timeout and once when the complete test reached 60 seconds. A controlled install of the same three tarballs and 92 packages took 17.9 seconds with a new empty cache versus 3.5 seconds with the normal npm cache.

- [x] **Step 2: Apply the minimal test-infrastructure change**

Delete only the empty-cache override from `npmEnvironment`:

```js
const npmEnvironment = {
  ...process.env,
  npm_config_audit: 'false',
  npm_config_prefer_offline: 'true',
};
```

Do not increase the 50-second install timeout or the 60-second test timeout, and do not change product assertions.

- [x] **Step 3: Verify focused GREEN**

```powershell
node --test --test-name-pattern="packed CLI node entry serves health JSON and the packaged Web UI" packages/cli/test/installed-runtime.test.mjs
```

Expected: 1/1 passes, the packed CLI serves health and WebUI, and the selected port closes.

- [x] **Step 4: Verify CLI and repository GREEN**

```powershell
npm.cmd test --workspace @harness/cli
npm.cmd test
```

Expected: CLI 4/4 and every workspace test pass. If the packed test still times out, stop and return to diagnosis without adding a timeout change.

- [x] **Step 5: Review and request integration approval**

```powershell
git diff -- packages/cli/test/installed-runtime.test.mjs docs/superpowers/plans/2026-08-13-windows-cli-cleanup-fix.md
git diff --check
git status --short
```

Expected: the code change is the one deleted cache line; the updated plan records the evidence; Pages plan and `safe-example.ts` remain untracked. Do not commit this task without human approval.
