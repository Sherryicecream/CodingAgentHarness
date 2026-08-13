# Local-First Final Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a static online mechanism demo and a complete loopback-only local Harness with OS-keyring credentials and durable manifest-driven artifact export.

**Architecture:** Stabilize the existing final-delivery branch before changing behavior. Replace the file/master-password credential subsystem behind a small injected keyring port, then separate session artifact tracking from durable export. Build the public demonstration from a browser-only entry whose dependency closure excludes privileged and credential code.

**Tech Stack:** TypeScript, Node.js 22, React 19, Express 4, Vitest, Node test runner, Vite, tsup, `@napi-rs/keyring`, npm workspaces, GitHub Pages.

---

## File responsibility map

- `packages/core/src/index.ts`: public Core package boundary consumed by Server.
- `packages/server/src/credential-store.ts`: injected OS-keyring credential service; no HTTP or UI policy.
- `packages/server/src/routes/config.ts`: local credential HTTP contract.
- `packages/server/client/src/components/ConfigPage.tsx`: two-choice DeepSeek setup UI.
- `packages/server/src/session/artifact-tracker.ts`: session-scoped immutable artifact metadata.
- `packages/server/src/session/artifact-exporter.ts`: secure, atomic durable export.
- `packages/server/src/routes/agent.ts`: thin orchestration routes for runs and export.
- `packages/server/client/src/components/ArtifactExport.tsx`: manifest display and export action.
- `packages/server/client/src/static-demo/`: browser-only deterministic public demo.
- `scripts/verify-static-boundary.mjs`: checks that privileged/local modules cannot enter the static bundle.

### Task 1: Restore a truthful green baseline

**Files:**
- Modify: `packages/server/test/provider-execution.test.ts`
- Modify: `packages/server/test/client/public-modes.test.tsx`
- Modify: `packages/server/src/provider-execution.ts`
- Modify: `packages/server/src/agent/privileged-agent-run.ts`
- Modify: `packages/server/src/credential-store.ts`
- Modify: `packages/server/src/routes/test-key.ts`
- Modify: `packages/server/src/session/workspace-manager.ts`
- Modify: `packages/server/test/**/*.test.ts`
- Modify: `packages/server/package.json`
- Modify: `packages/cli/package.json`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.gitlab-ci.yml`

- [ ] **Step 1: Capture the existing failures without changing production code**

Run:

```powershell
npm.cmd test --workspace @harness/server
npm.cmd exec tsc -- -p packages/server/tsconfig.json --noEmit
npm.cmd exec tsc -- -p packages/cli/tsconfig.json --noEmit
```

Expected: the three known Server tests fail; Server and CLI typechecks fail.

- [ ] **Step 2: Correct stale UI assertions**

Update the two configuration-page assertions to the approved current behavior:

```ts
await screen.findByText('第 1 步：凭据状态');
expect(screen.getByText('公共演示模式不会接收或保存 API Key。')).toBeTruthy();
```

Run the two named tests and expect PASS.

- [ ] **Step 3: Preserve the Provider security distinction**

Make the malformed stored record in the endpoint test otherwise valid so the test reaches the endpoint allowlist check. Keep the production order: parse/validate record, then compare the endpoint against the built-in allowlist. Run `provider-execution.test.ts` and expect PASS.

- [ ] **Step 4: Fix production type boundaries**

Remove the nonexistent `mode` property passed to `ConfiguredProviderAdapterDependencies`; type the scrypt metadata with its literal constants; distinguish DOM `Response` from Express `Response`; add `isFile()` to the workspace stat port; and update typed test doubles with required fields. Do not weaken types with `any` or `@ts-ignore`.

- [ ] **Step 5: Export Server declarations**

Change Server build to emit declarations and define a typed export:

```json
"build": "tsup src/server.ts --format esm --dts --clean && vite build client --emptyOutDir",
"types": "./dist/server.d.ts"
```

Run Core, Server, and CLI typechecks. Expected: all exit 0.

- [ ] **Step 6: Add one root typecheck command and enforce it in CI**

Add workspace `typecheck` scripts and:

```json
"typecheck": "npm run typecheck --workspaces --if-present"
```

Run `npm.cmd run typecheck`. Expected: PASS. Add it between install and tests in both CI files.

- [ ] **Step 7: Bound the CLI lifecycle test**

Split the packed-runtime test so package creation and installed-runtime lifecycle each report progress and have finite child-process timeouts. Cleanup must terminate descendants on Windows and Unix. Run the CLI suite twice; each run must finish within its declared timeout and leave no listener.

- [ ] **Step 8: Verify and commit**

Run:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected: all exit 0. Commit as `fix: restore final delivery verification baseline`.

### Task 2: Replace master-password storage with an OS-keyring port

**Files:**
- Modify: `packages/server/package.json`
- Modify: `package-lock.json`
- Rewrite: `packages/server/src/credential-store.ts`
- Create: `packages/server/src/credential-keyring.ts`
- Rewrite: `packages/server/test/credential-store.test.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Write the keyring service contract tests**

Define the desired port in tests:

```ts
interface CredentialKeyring {
  get(service: string, account: string): Promise<string | null>;
  set(service: string, account: string, secret: string): Promise<void>;
  delete(service: string, account: string): Promise<boolean>;
}
```

Test status, set, update, delete, unavailable backend, and absence of secret values in returned objects. Run the test and confirm RED because the new API is absent.

- [ ] **Step 2: Implement the minimal injected credential service**

Use service `CodingAgentHarness` and account `deepseek-api-key`. Return only:

```ts
type CredentialStatus = {
  storage: 'keyring' | 'unavailable';
  hasKey: boolean;
};
```

Run the focused tests and expect PASS.

- [ ] **Step 3: Add the native adapter**

Add `@napi-rs/keyring`. Dynamically load it in `credential-keyring.ts`; translate backend absence or initialization failure to an unavailable backend without writing a fallback file. Unit tests inject fakes and must not load a real keyring.

- [ ] **Step 4: Remove encrypted-file behavior**

Delete scrypt/AES/master-password/legacy-file code and environment seams that name credential files. Preserve `DEEPSEEK_API_KEY` only as explicit runtime precedence. Verify repository search finds no production reference to `masterPassword`, `credentials.enc`, or `HARNESS_CREDENTIALS_FILE`.

- [ ] **Step 5: Verify and commit**

Run credential tests, Server tests, typecheck, and build. Commit as `refactor: store persistent credentials in the OS keyring`.

### Task 3: Simplify credential routes and WebUI

**Files:**
- Rewrite: `packages/server/src/routes/config.ts`
- Modify: `packages/server/src/routes/test-key.ts`
- Rewrite: `packages/server/client/src/components/ConfigPage.tsx`
- Delete: `packages/server/client/src/components/ProviderConfiguration.tsx`
- Delete: `packages/server/src/provider-configuration.ts`
- Delete: `packages/server/src/provider-execution.ts`
- Modify: `packages/server/src/agent/privileged-agent-run.ts`
- Modify: `packages/server/src/agent/agent-run-types.ts`
- Modify: `packages/server/src/routes/agent.ts`
- Rewrite: `packages/server/test/routes/config-policy.test.ts`
- Delete: `packages/server/test/routes/provider-config.test.ts`
- Delete: `packages/server/test/provider-execution.test.ts`
- Delete: `packages/server/test/client/provider-config.test.tsx`

- [ ] **Step 1: Write failing route tests for the reduced API**

Required routes:

```text
GET    /api/config/status
PUT    /api/config/key
DELETE /api/config/key
POST   /api/agent/test-key
```

`PUT` accepts `{ key }`; status never returns the key. Public/static policy rejects all credential operations. Confirm RED against the current master-password routes.

- [ ] **Step 2: Implement the reduced routes**

Remove unlock/initialize/provider routes. Keep error codes stable and non-secret. Run route tests and expect PASS.

- [ ] **Step 3: Write failing UI tests for the two choices**

Test a linear page with “仅本次使用” and “记住在此设备”, Key input, save/test/delete actions, and an unavailable-keyring explanation. Confirm RED.

- [ ] **Step 4: Implement the linear configuration page**

Keep memory-only Key ownership in the run form/component lifecycle; use the config route only for remembered credentials. Clear input state on success, failure, mode switch, and unmount. Run UI tests and expect PASS.

- [ ] **Step 5: Remove generic Provider execution**

Remove `providerId` from run input and delete Provider UI/routes/services/tests. Keep `LLMAdapter` as the documented extension point. Run a repository search to prove no production `providerId` or `/providers` remains.

- [ ] **Step 6: Verify and commit**

Run Server tests, typecheck, and build. Commit as `refactor: simplify local DeepSeek configuration`.

### Task 4: Track generated artifacts by session

**Files:**
- Create: `packages/server/src/session/artifact-tracker.ts`
- Create: `packages/server/test/session/artifact-tracker.test.ts`
- Modify: `packages/server/src/agent/tool-registry-factory.ts`
- Modify: `packages/server/src/session/session-registry.ts`
- Modify: `packages/server/src/routes/agent.ts`

- [ ] **Step 1: Write failing artifact-tracker tests**

Assert immutable records containing relative path, operation, size, SHA-256, timestamp, and tool-call ID. Test repeated writes collapse to the latest digest while preserving `created` semantics. Confirm RED.

- [ ] **Step 2: Implement the tracker**

Implement a session-scoped tracker with no filesystem authority. It accepts already-validated write results from the tool orchestration layer. Run focused tests and expect PASS.

- [ ] **Step 3: Integrate successful write events**

Record only successful `write_file` calls inside the issued workspace. Add route output for listing the current session artifact manifest without absolute source paths. Run integration tests and expect PASS.

- [ ] **Step 4: Verify and commit**

Run Server tests and typecheck. Commit as `feat: track generated session artifacts`.

### Task 5: Export artifacts durably and atomically

**Files:**
- Create: `packages/server/src/session/artifact-exporter.ts`
- Create: `packages/server/test/session/artifact-exporter.test.ts`
- Modify: `packages/server/src/session/workspace-manager.ts`
- Modify: `packages/server/src/routes/agent.ts`
- Modify: `packages/server/test/routes/public-agent-routes.test.ts`
- Create: `packages/server/client/src/components/ArtifactExport.tsx`
- Create: `packages/server/test/client/artifact-export.test.tsx`
- Modify: `packages/server/client/src/components/ChatPanel.tsx`

- [ ] **Step 1: Write failing exporter security tests**

Cover nested files, multiple files, binary data, digest mismatch, traversal, absolute paths, symlinks, `.git`, existing export conflicts, and staging cleanup after injected failure. Confirm RED.

- [ ] **Step 2: Implement atomic export**

Copy verified sources into a sibling staging directory, write `manifest.json`, fsync/close files where supported, then rename staging to `.harness/outputs/<session-id>`. Never merge into an existing completed export. Run focused tests and expect PASS.

- [ ] **Step 3: Replace the manual single-file route**

Change the save endpoint to export the current immutable artifact set. Remove the user-supplied `fileName` contract and the coupling between export and workspace `preserve`. Run route tests and expect PASS.

- [ ] **Step 4: Write and implement the manifest-driven UI**

Show all artifacts and one “导出全部产物” action. Display the durable destination returned by the server. Do not ask users to type paths. Run component tests and expect PASS.

- [ ] **Step 5: Prove cleanup separation**

Add an integration test: export succeeds, temporary session expires, workspace is removed, exported files and manifest remain readable. Run it and expect PASS.

- [ ] **Step 6: Verify and commit**

Run Server tests, typecheck, and build. Commit as `feat: export generated artifacts with a verified manifest`.

### Task 6: Apply exported changes through Governance

**Files:**
- Create: `packages/server/src/session/project-change-applier.ts`
- Create: `packages/server/test/session/project-change-applier.test.ts`
- Modify: `packages/server/src/routes/agent.ts`
- Modify: `packages/server/client/src/components/ArtifactExport.tsx`
- Modify: `packages/core/src/guardrail/index.ts`
- Modify: `packages/core/test/guardrail/integration.test.ts`

- [ ] **Step 1: Write failing approval-binding tests**

Test that replacement of an existing project file is dangerous, approval binds to manifest digest plus destination set, approval is single-use, and any changed digest invalidates it. Confirm RED.

- [ ] **Step 2: Implement preview-only project diffs**

Generate path and text diff previews without writing. Binary files report metadata only. Run preview tests and expect PASS.

- [ ] **Step 3: Implement approved atomic application**

Reject traversal, symlinks, `.git`, changed manifests, and unapproved replacement. Use same-directory temporary files followed by rename. Run focused tests and expect PASS.

- [ ] **Step 4: Add WebUI preview and approval flow**

Expose “应用到项目” only in local mode. Show paths/diffs before requesting approval. Run UI and route tests and expect PASS.

- [ ] **Step 5: Verify and commit**

Run Core/Server tests, typecheck, and build. Commit as `feat: apply generated changes through HITL`.

### Task 7: Build the serverless static mechanism demo

**Files:**
- Create: `packages/server/client/static-demo.html`
- Create: `packages/server/client/src/static-demo/main.tsx`
- Create: `packages/server/client/src/static-demo/StaticDemoApp.tsx`
- Create: `packages/server/client/src/static-demo/scenario.ts`
- Create: `packages/server/test/client/static-demo.test.tsx`
- Create: `scripts/verify-static-boundary.mjs`
- Create: `scripts/verify-static-boundary.test.mjs`
- Modify: `packages/server/client/vite.config.ts`
- Modify: `packages/server/package.json`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write failing deterministic scenario tests**

Assert the exact event order: decision, safe tool, dangerous block, failing test, structured feedback, changed action, passing test. Confirm RED.

- [ ] **Step 2: Implement a browser-only scenario reducer**

Use fixed typed events and no network calls. Run focused tests and expect PASS.

- [ ] **Step 3: Write failing bundle-boundary tests**

Build with a Vite metafile or manifest and reject dependencies matching credential stores, DeepSeek adapters, Express, child processes, Shell/Git tools, session persistence, and local API clients. Confirm RED before the separate entry exists.

- [ ] **Step 4: Implement the static entry and build**

Create `build:static-demo` output suitable for GitHub Pages. It presents the project boundary and replayable mechanism timeline, with a link to local installation instructions. Run build and boundary verification; expect PASS.

- [ ] **Step 5: Add Pages workflow steps**

Only after typecheck, tests, production build, and static-boundary verification pass, upload and deploy the static artifact. Do not add cloud secrets.

- [ ] **Step 6: Verify and commit**

Run static tests, static build, boundary verification, and the root verification suite. Commit as `feat: add serverless static mechanism demo`.

### Task 8: Final package, documentation, and delivery evidence

**Files:**
- Modify: `README.md`
- Modify: `SPEC.md`
- Modify: `PLAN.md`
- Modify: `SPEC_PROCESS.md`
- Modify: `AGENT_LOG.md`
- Student review only: `REFLECTION.md`
- Modify: `scripts/check-document-consistency.mjs`
- Modify: `scripts/verify-packages.mjs`

- [ ] **Step 1: Write failing documentation checks**

Require explicit static-demo/local-product separation, keyring behavior, memory fallback, artifact export path, no master-password claims, no unverified server URL, and release URLs only after a release actually exists. Confirm RED against current documents.

- [ ] **Step 2: Restore the complete course SPEC structure**

Preserve at least five INVEST stories, module I/O/error boundaries, non-functional requirements, architecture, data model, credential threat model, distribution, technology rationale, acceptance criteria, and risks. Incorporate the approved design without replacing the full course specification with a status summary.

- [ ] **Step 3: Align operational documents**

README documents source install, local CLI, system keyring, static URL, artifact export, limitations, and release acquisition. PLAN and AGENT_LOG record actual commits and verification evidence. SPEC_PROCESS records the design change and deviations honestly.

- [ ] **Step 4: Request student-owned reflection edits**

Provide a factual checklist for the student to reduce `REFLECTION.md` to 1500–2500 Chinese characters and correct deployment/test claims. Do not author the reflection on the student's behalf.

- [ ] **Step 5: Verify package installation in a clean temporary directory**

Build and pack Core, Server, and CLI; install the tarballs; start the installed CLI on a loopback port; verify health and WebUI; terminate it; verify the port closes and no temporary credential file appears.

- [ ] **Step 6: Run final verification**

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run verify:packages
npm.cmd run build:static-demo
npm.cmd run verify:static-boundary
npm.cmd run check:docs
```

Expected: every command exits 0 with no failed tests.

- [ ] **Step 7: Commit the final documentation evidence**

Commit as `docs: align final local-first delivery evidence`. Publishing a Release, pushing, and enabling GitHub Pages are separate external actions and require explicit authorization at that time.
