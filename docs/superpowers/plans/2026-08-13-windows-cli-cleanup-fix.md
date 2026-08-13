# Windows CLI Cleanup Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Windows CLI lifecycle regression clean its detached fixture deterministically without weakening the production cleanup assertion.

**Architecture:** Keep the existing production-behavior test unchanged through its expected cleanup failure, then terminate only the fixture Server's recorded PID with Node's cross-platform process API in `finally`. Re-run the full suite before considering any packed-CLI startup change.

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
