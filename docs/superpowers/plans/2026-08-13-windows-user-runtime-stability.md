# Windows User Runtime Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the documented Windows Node.js 22 local-runtime path wait for real server readiness and leave no shell descendants after command timeout.

**Architecture:** Preserve the public tool and server interfaces. Add explicit Windows process-tree termination behind `execute_shell`, and make `startServer()` bridge the HTTP listener's callback/error lifecycle into its existing promise. Verify production behavior first with focused regressions, then validate the packed CLI and the complete clean-install path.

**Tech Stack:** TypeScript, Node.js 22, `node:child_process`, Express/Node HTTP server, Vitest, Node test runner, npm workspaces.

## Global Constraints

- Target runtime is Node.js 22 LTS on Windows PowerShell; examples use `npm.cmd`.
- Do not add dependencies or change public/local security policy.
- Do not interpolate user commands into process-cleanup commands.
- Preserve `startServer(): Promise<HarnessApp>` and `createExecuteShellTool(...)` public signatures.
- Do not stage `packages/server/safe-example.ts`, `.harness/`, credentials, generated builds, the final ZIP, or `submission.jsonc`.

---

### Task 1: Terminate timed-out Windows shell trees

**Files:**
- Modify: `packages/core/test/tools/execute-shell.test.ts`
- Modify: `packages/core/src/tools/execute-shell.ts`

**Interfaces:**
- Consumes: the PID returned by `exec()` and the existing `timeout` option.
- Produces: `terminateWindowsProcessTree(pid: number): Promise<void>` as an internal helper; the public `Tool.execute()` result shape remains unchanged.

- [ ] **Step 1: Strengthen the failing timeout regression**

Change the existing timeout test so every platform requires `result.success === false` and `result.error` to be defined. Immediately call `fs.rmSync(workspaceRoot, { recursive: true, force: true })`, assert the path no longer exists, then assign a newly created disposable path so `afterEach` remains safe.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
npm.cmd test --workspace @harness/core -- test/tools/execute-shell.test.ts
```

Expected on the current Windows baseline: FAIL with `EBUSY` while removing the timed-out command's workspace.

- [ ] **Step 3: Implement explicit Windows tree termination**

Use `spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })` without `shell`. Resolve its helper on `close`; reject only spawn errors. In `execute()`, use a manual Windows timer, wait for tree termination before resolving the command callback, and retain Node's native `exec` timeout on non-Windows systems.

- [ ] **Step 4: Verify GREEN and regressions**

```powershell
npm.cmd test --workspace @harness/core -- test/tools/execute-shell.test.ts
npm.cmd run typecheck --workspace @harness/core
```

Expected: 7/7 tool tests pass, including immediate workspace deletion; type checking exits zero.

- [ ] **Step 5: Commit the shell lifecycle fix**

```powershell
git add packages/core/src/tools/execute-shell.ts packages/core/test/tools/execute-shell.test.ts
git commit -m "fix(core): terminate timed-out Windows process trees"
```

### Task 2: Await real HTTP listener readiness

**Files:**
- Modify: `packages/server/test/demo/public-demo-boundary.test.ts`
- Modify: `packages/server/src/server.ts`

**Interfaces:**
- Consumes: the callback and `error` event of the Node HTTP server returned by `app.listen()`.
- Produces: the unchanged `startServer(): Promise<HarnessApp>` interface, now resolved only after listening.

- [ ] **Step 1: Write the failing readiness regression**

Mock `Server.prototype.listen` with a controllable callback. Call `startServer()`, verify the promise remains unsettled for one microtask, invoke the callback, then expect the same `HarnessApp` to resolve. Add a second test where the mocked server emits `error` before listening and expect rejection plus `app.close()` cleanup.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
npm.cmd test --workspace @harness/server -- test/demo/public-demo-boundary.test.ts
```

Expected: the current implementation resolves before the controlled listening callback or fails to reject the simulated binding error.

- [ ] **Step 3: Implement the readiness bridge**

Wrap `app.listen(port, host, callback)` in a promise. Attach a one-time pre-listening `error` handler, remove it after the listening callback, log the ready URL, and return `app` only after the promise resolves. On error, await `app.close()` and reject with the original error.

- [ ] **Step 4: Verify GREEN and regressions**

```powershell
npm.cmd test --workspace @harness/server -- test/demo/public-demo-boundary.test.ts
npm.cmd run typecheck --workspace @harness/server
```

Expected: readiness and rejection regressions pass; type checking exits zero.

- [ ] **Step 5: Commit the server readiness fix**

```powershell
git add packages/server/src/server.ts packages/server/test/demo/public-demo-boundary.test.ts
git commit -m "fix(server): await HTTP listener readiness"
```

### Task 3: Validate packed CLI timing without weakening behavior

**Files:**
- Modify only if measured necessary: `packages/cli/test/installed-runtime.test.mjs`

**Interfaces:**
- Consumes: packed Core, Server and CLI tarballs plus loopback HTTP polling.
- Produces: evidence that the installed CLI serves health/config/Web UI and releases the port.

- [ ] **Step 1: Run the focused packed-runtime test on Node 22**

```powershell
node --test --test-name-pattern="packed CLI node entry serves health JSON and the packaged Web UI" packages/cli/test/installed-runtime.test.mjs
```

Expected after Task 2: PASS. Record build, install and readiness timings.

- [ ] **Step 2: Adjust budgets only if product is healthy but cold execution exceeds them**

If and only if the health endpoint eventually succeeds outside the current window, raise the integration test's 60-second total timeout and/or 15-second readiness deadline to the smallest rounded values covering the measured cold run with reasonable Windows margin. Do not remove health, config, Web UI, cleanup or port assertions.

- [ ] **Step 3: Verify the complete CLI suite**

```powershell
npm.cmd test --workspace @harness/cli
```

Expected: 4/4 pass and the selected loopback ports close.

- [ ] **Step 4: Commit only if timing code changed**

```powershell
git add packages/cli/test/installed-runtime.test.mjs
git commit -m "test(cli): allow measured Windows cold-start time"
```

### Task 4: Fresh user-path verification and final archive

**Files:**
- Modify if evidence changes: `README.md`
- Modify if evidence changes: `PLAN.md`
- Modify if evidence changes: `AI4SE_DELIVERY_CHECKLIST.md`
- Recreate outside Git: `.harness/submission-staging/CodingAgentHarness-source-<commit>.zip`
- Preserve outside Git: `.harness/submission-staging/submission.jsonc`

**Interfaces:**
- Consumes: a clean `git archive` of the final commit and official Node.js 22.
- Produces: the two side-by-side course submission files.

- [ ] **Step 1: Run complete repository verification**

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run typecheck
npm.cmd run verify:packages
npm.cmd run check:docs
npm.cmd run test:docs
git diff --check
```

Expected: every command exits zero with no test failures.

- [ ] **Step 2: Validate an actual local CLI session**

Start the built CLI on `127.0.0.1` with a free port and keyring disabled. Poll `/api/health`, `/api/config/status`, and `/`; verify HTTP 200 and expected JSON/HTML. Terminate the CLI, require three consecutive connection failures, and confirm no listener remains.

- [ ] **Step 3: Update durable evidence if needed, then commit and push**

Do not claim a specific run is permanently “latest.” Commit only accurate durable evidence, push `master`, and wait for GitHub Actions success.

- [ ] **Step 4: Rebuild and inspect the source ZIP**

Use `git archive --format=zip --prefix=CodingAgentHarness/ <final-commit>`. Compare every archive entry with `git ls-tree`, require all course documents, reject `.git`, `.harness`, `node_modules`, `dist`, `.env`, key files, `safe-example.ts`, and `submission.jsonc`, and scan text entries for credential patterns.

- [ ] **Step 5: Validate submission metadata**

Parse the comment-stripped `submission.jsonc` and require: `id=251250277`, `name=苏雨`, the repository URL, `is_deployed=false`, and the v0.1.0 Release URL. Confirm the staging directory contains exactly the ZIP and `submission.jsonc` as sibling files.
