# Public API Security and BYOK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve an anonymously accessible Web UI while replacing the public arbitrary-code-execution boundary with a deterministic demo path and an HTTPS-only BYOK path using restricted tools.

**Architecture:** Refactor Express into an injectable app factory, derive capabilities from a fail-closed runtime policy, issue server-owned sessions and workspaces, and build tool registries exclusively from server policy. Public demo execution uses an in-process scenario runner; public BYOK execution uses a transient DeepSeek adapter with file-only tools; trusted local mode retains the full tool set.

**Tech Stack:** TypeScript, Express 4, React 19, Vitest, Supertest, React Testing Library, express-rate-limit

## Global Constraints

- All work occurs in `D:/CodingAgentHarness/.worktrees/public-api-security` on `codex/public-api-security`.
- `HARNESS_MODE` accepts only `public` and `local`; absent or invalid values resolve to `public`.
- Public mode never registers `execute_shell`, `run_tests`, `git_diff`, or `git_commit`.
- Clients never choose a filesystem root; `workingDir` is rejected as an unknown request field.
- A BYOK value exists only in browser component state and the active request/adapter call graph; it is never persisted or emitted.
- BYOK requires HTTPS, except for loopback development.
- Task length is 1–4000 characters and JSON request bodies are limited to 64 KB.
- Default limits are 20 run attempts per hour per IP and two concurrent runs per IP.
- Existing HITL resume behavior, credential encryption, dependency-audit findings, and CI Node alignment are not modified.
- Every behavior change follows RED → GREEN → refactor, with the named focused test run before the full suite.

---

### Task 1: Server test harness and injectable app factory

**Files:**
- Modify: `packages/server/package.json`
- Modify: `packages/server/tsconfig.json`
- Create: `packages/server/vitest.config.ts`
- Create: `packages/server/src/app.ts`
- Modify: `packages/server/src/server.ts`
- Create: `packages/server/test/app.test.ts`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `createApp(options?: AppOptions): Express` from `src/app.ts`.
- Produces: `AppOptions` with optional `mode`, `workspaceRoot`, `now`, `idGenerator`, `fetchImpl`, and `logger` overrides.
- Preserves: `src/server.ts` as the only module that calls `app.listen()`.

- [ ] **Step 1: Add a failing import-and-health test**

```ts
import request from 'supertest';
import { createApp } from '../src/app.js';

it('creates an app without opening a network listener', async () => {
  const response = await request(createApp({ mode: 'public' })).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok', mode: 'public' });
});
```

Run: `npm test --workspace @harness/server -- app.test.ts`

Expected RED: `src/app.ts` cannot be resolved.

- [ ] **Step 2: Add explicit test dependencies and scripts**

Add `test: "vitest run"` and explicit dev dependencies `vitest`, `supertest`, and `@types/supertest`. Update `tsconfig.json` to include `src` and `test` without forcing test files under the production `rootDir`; configure Vitest for Node.

- [ ] **Step 3: Extract `createApp` and keep listening in `server.ts`**

`createApp` disables `x-powered-by`, applies `express.json({ limit: '64kb' })`, configures same-origin CORS, mounts current routers, and returns the app. `server.ts` creates the app and listens using `PORT` and `HOST`.

- [ ] **Step 4: Verify GREEN and full baseline**

Run: `npm test --workspace @harness/server -- app.test.ts`

Expected: the health test passes.

Run: `npm test`

Expected: 278 core tests plus the new server test pass.

- [ ] **Step 5: Commit**

Commit: `test(server): add injectable app test harness`

---

### Task 2: Fail-closed runtime policy and policy-owned tool registries

**Files:**
- Create: `packages/server/src/security/runtime-policy.ts`
- Create: `packages/server/src/agent/tool-registry-factory.ts`
- Create: `packages/server/test/security/runtime-policy.test.ts`
- Create: `packages/server/test/agent/tool-registry-factory.test.ts`

**Interfaces:**
- Produces: `resolveRuntimePolicy(value?: string): RuntimePolicy`.
- Produces: `RuntimePolicy` with `mode`, `allowServerCredentials`, `allowByok`, `allowProcessTools`, and `allowedExperiences`.
- Produces: `createPolicyToolRegistry(policy, workspaceRoot): ToolRegistry`.

- [ ] **Step 1: Write policy RED tests**

Assert that `undefined`, `''`, and `'unexpected'` resolve to public policy; public denies server credentials and process tools; local permits the complete trusted capability set.

Run: `npm test --workspace @harness/server -- runtime-policy.test.ts`

Expected RED: module missing.

- [ ] **Step 2: Implement the immutable policy objects**

Use frozen public/local constants and return public for every unrecognized value. Request bodies never participate in policy resolution.

- [ ] **Step 3: Write tool-registry RED tests**

```ts
expect(publicRegistry.list().map(tool => tool.name).sort())
  .toEqual(['read_file', 'search_code', 'write_file']);
expect(localRegistry.list().map(tool => tool.name))
  .toEqual(expect.arrayContaining(['execute_shell', 'run_tests', 'git_diff', 'git_commit']));
```

Run: `npm test --workspace @harness/server -- tool-registry-factory.test.ts`

Expected RED: factory missing.

- [ ] **Step 4: Implement the policy-owned registry factory**

Always register workspace-confined read/write/search. Register Shell, process tests, and Git tools only when `allowProcessTools` is true.

- [ ] **Step 5: Run focused and full tests, then commit**

Run both new test files, then `npm test`.

Commit: `security(server): derive tools from runtime policy`

---

### Task 3: Server-owned workspaces and session registry

**Files:**
- Create: `packages/server/src/session/workspace-manager.ts`
- Create: `packages/server/src/session/session-registry.ts`
- Create: `packages/server/test/session/workspace-manager.test.ts`
- Create: `packages/server/test/session/session-registry.test.ts`

**Interfaces:**
- Produces: `createWorkspaceManager({ root, fs?, now? }): WorkspaceManager`.
- `WorkspaceManager.create(sessionId): Promise<string>` returns a canonical child path.
- `WorkspaceManager.remove(sessionId): Promise<void>` only removes a previously issued child.
- Produces: `createSessionRegistry({ workspaceManager, now, idGenerator, ttlMs, maxConcurrent }): SessionRegistry`.
- `SessionRegistry.issue(clientKey): Promise<PublicSession>` and `getAuthorized(id, clientKey): PublicSession | null`.
- Session records contain no task text or credential fields.

- [ ] **Step 1: Write workspace isolation RED tests**

Create two sessions under a temporary root, assert distinct canonical directories, reject traversal IDs, reject removal of unissued paths, and verify removal cannot escape the configured root.

- [ ] **Step 2: Implement WorkspaceManager with boundary checks**

Resolve the configured root once, create only direct random-ID children, record issued canonical paths, and validate the final target before recursive removal.

- [ ] **Step 3: Write registry RED tests**

Assert server-generated IDs, client-key ownership, one-hour expiry, duplicate-start rejection, and `ConcurrentSessionLimitError` on the third running session for one client.

- [ ] **Step 4: Implement SessionRegistry state transitions**

Use `issued → running → completed|failed|expired`; count only running sessions for concurrency. Store `id`, `clientKey`, `workspace`, `status`, `createdAt`, and `expiresAt`.

- [ ] **Step 5: Run focused and full tests, then commit**

Commit: `security(server): isolate server-owned sessions`

---

### Task 4: Safe session, stream, run, and configuration routes

**Files:**
- Refactor: `packages/server/src/routes/agent.ts`
- Refactor: `packages/server/src/routes/config.ts`
- Modify: `packages/server/src/app.ts`
- Add dependency: `express-rate-limit` in `packages/server/package.json`
- Modify: `package-lock.json`
- Create: `packages/server/test/routes/public-agent-routes.test.ts`
- Create: `packages/server/test/routes/config-policy.test.ts`

**Interfaces:**
- Produces: `createAgentRouter(deps): Router` instead of module-global mutable state.
- Produces: `createConfigRouter({ policy, credentialStore }): Router`.
- `POST /api/agent/sessions` returns `{ sessionId, mode, capabilities, expiresAt }`.
- `POST /api/agent/run` accepts exactly `{ sessionId, task, mode, apiKey? }`.

- [ ] **Step 1: Write request-boundary RED tests**

Cover server-issued session IDs, `workingDir` rejection, unknown-field rejection, 400 for empty/overlong tasks, 404 for unknown sessions, 409 for duplicate runs, 429 for concurrency excess, and rejection when the request IP does not own the session.

- [ ] **Step 2: Write public-config RED tests**

Inject a credential store whose methods throw if called. Assert every `/api/config/*` endpoint returns 403 in public mode without invoking the store; assert local mode still reaches the injected store.

- [ ] **Step 3: Implement router factories and validation**

Remove all module-level stores/maps. Derive a normalized client key from `req.ip`. Reject request objects whose key set is not a subset of `sessionId`, `task`, `mode`, `apiKey`. The effective capability set always comes from RuntimePolicy.

- [ ] **Step 4: Apply rate and body limits**

Apply express-rate-limit to run attempts with 20 requests/hour/IP defaults and injectable/test overrides. Convert SessionRegistry concurrency errors to 429.

- [ ] **Step 5: Run focused and full tests, then commit**

Commit: `security(server): enforce safe public API boundaries`

---

### Task 5: HTTPS-only transient BYOK and secret-safe events/errors

**Files:**
- Create: `packages/server/src/security/request-security.ts`
- Create: `packages/server/src/security/secret-redactor.ts`
- Modify: `packages/server/src/routes/agent.ts`
- Modify: `packages/server/src/sse/sse-manager.ts`
- Create: `packages/server/test/security/byok.test.ts`
- Create: `packages/server/test/security/secret-redactor.test.ts`
- Create: `packages/server/test/sse/sse-secrets.test.ts`

**Interfaces:**
- Produces: `isSecureByokRequest(req): boolean` accepting TLS or loopback only.
- Produces: `redactSecrets(value, secrets): unknown` recursively replacing exact secret occurrences with `[REDACTED]`.
- SSEManager accepts a per-session secret-redaction context that is cleared on close.

- [ ] **Step 1: Write HTTPS-boundary RED tests**

Assert public BYOK returns 400 `BYOK_REQUIRES_HTTPS` over ordinary HTTP, accepts `X-Forwarded-Proto: https` with one trusted proxy hop, and accepts loopback development. Demo mode remains available over HTTP.

- [ ] **Step 2: Write non-persistence RED tests**

Use a sentinel key and injected adapter factory. Complete a BYOK run and assert the sentinel is absent from serialized session records, SSE output, captured logs, and returned errors.

- [ ] **Step 3: Write upstream-error sanitization RED test**

Inject a provider failure containing the sentinel and provider body. Assert the response/event contains only `LLM_PROVIDER_ERROR` and safe status metadata.

- [ ] **Step 4: Implement transient adapter creation and redaction**

Construct the DeepSeek adapter inside the run path from the request key, never attach the key to session state, redact emitted values, and clear the SSE redaction context and local adapter/key references in `finally`.

- [ ] **Step 5: Run focused and full tests, then commit**

Commit: `security(server): protect transient BYOK credentials`

---

### Task 6: Deterministic subprocess-free public demonstration

**Files:**
- Create: `packages/server/src/demo/public-demo-runner.ts`
- Create: `packages/server/test/demo/public-demo-runner.test.ts`
- Modify: `packages/server/src/routes/agent.ts`

**Interfaces:**
- Produces: `createPublicDemoRunner({ emit, workspaceManager, now? }): PublicDemoRunner`.
- `PublicDemoRunner.run(session): Promise<DemoResult>` emits the same SSE event categories used by the UI.
- The runner invokes core governance and feedback components with injected in-process results; it never imports or calls `node:child_process`.

- [ ] **Step 1: Write the mechanism-demonstration RED test**

Run the scenario and assert ordered events include: safe file write, dangerous action rejected by governance, injected validation failure, structured feedback, corrected file write, validation pass, and complete.

- [ ] **Step 2: Add a no-subprocess architectural test**

Read the demo module source and assert it contains no `child_process`, `exec`, `spawn`, `execute_shell`, or process-based `run_tests` import/registration.

- [ ] **Step 3: Implement the in-process scenario**

Use MockLLMAdapter-compatible scripted actions, `createGovernanceService`, and `createFeedbackLoop` with an injected TestRunner returning one deterministic failure followed by pass. File writes remain inside the issued demo workspace.

- [ ] **Step 4: Route demo requests to the demo runner**

Public `{ mode: 'demo' }` never constructs DeepSeekAdapter and never reads CredentialStore.

- [ ] **Step 5: Run focused and full tests, then commit**

Commit: `feat(server): add safe deterministic public demo`

---

### Task 7: Public/local mode UI and in-memory BYOK

**Files:**
- Modify: `packages/server/client/src/App.tsx`
- Modify: `packages/server/client/src/components/ChatPanel.tsx`
- Modify: `packages/server/client/src/components/ConfigPage.tsx`
- Modify: `packages/server/client/src/hooks/useSSE.ts`
- Create: `packages/server/client/src/hooks/useRuntimeInfo.ts`
- Modify: `packages/server/client/src/styles.css`
- Add dev dependencies: `@testing-library/react`, `@testing-library/user-event`, `jsdom`
- Modify: `package-lock.json`
- Create: `packages/server/test/client/public-modes.test.tsx`

**Interfaces:**
- `useRuntimeInfo()` loads effective mode/capabilities from the session-creation response.
- `ChatPanel` creates a server session before SSE connection and sends `{ sessionId, task, mode, apiKey? }`.
- API key state lives only in `ChatPanel` React state and is cleared after submission completes or the user switches mode.

- [ ] **Step 1: Write UI RED tests**

Assert public UI offers “安全演示” and “使用自己的 API Key”; public mode hides the server credential-management tab; insecure non-loopback context disables BYOK with an HTTPS explanation; entering a key does not call localStorage/sessionStorage; the run body omits `workingDir`.

- [ ] **Step 2: Implement server-session-first SSE flow**

Replace `generateSessionId` use with `POST /api/agent/sessions`, then set the returned ID, wait for SSE, and submit the run.

- [ ] **Step 3: Implement explicit mode and key controls**

Add a mode selector and a password input for BYOK. Show capability labels and local/public mode banners. Clear key state after completion, error, or mode switch.

- [ ] **Step 4: Hide local credential management in public mode**

Keep ConfigPage unchanged for local mode, but do not render or route to it in public mode.

- [ ] **Step 5: Run UI tests, full tests, and build, then commit**

Run: `npm test --workspace @harness/server -- public-modes.test.tsx`

Run: `npm test`

Run: `npm run build`

Commit: `feat(web): add public demo and transient BYOK modes`

---

### Task 8: Documentation, security regression audit, and final verification

**Files:**
- Modify: `README.md`
- Modify: `SPEC.md`
- Modify: `AGENT_LOG.md`
- Modify: `PLAN.md`
- Test: all server and core tests

**Interfaces:**
- Documents exact values for `HARNESS_MODE`, `HARNESS_WORKSPACE_ROOT`, rate/concurrency overrides, reverse-proxy trust, and HTTPS requirements.
- Explicitly distinguishes anonymous demo, public BYOK restricted tools, and local full tools.

- [ ] **Step 1: Update user and deployment documentation**

Remove claims that anonymous public visitors receive arbitrary Shell access. Document that HTTP supports demo only, BYOK requires HTTPS, public keys are never persisted, and local mode is required for complete coding-agent tools.

- [ ] **Step 2: Record process evidence**

Add the worktree path, branch, design/plan commits, RED/GREEN commands, reviews, human decisions, and final commit hashes to AGENT_LOG and the relevant PLAN completion table.

- [ ] **Step 3: Run placeholder and secret scans**

Scan changed files for `TODO`, `TBD`, unresolved URL/IP placeholders, GitHub OAuth token patterns, and realistic API-key assignments. Output only paths/counts for secret patterns.

- [ ] **Step 4: Run full verification**

Run `npm test`, `npm run build`, `git diff --check`, and inspect `git status --short`.

Expected: all core/server/client tests pass, all packages build, no whitespace errors, and no unintended files.

- [ ] **Step 5: Conduct two-stage review**

First compare every accepted design requirement against code/tests. Then perform correctness, readability, architecture, security, and performance review. Fix every Critical/Required finding through a new RED/GREEN cycle.

- [ ] **Step 6: Commit documentation**

Commit: `docs: document public and local security modes`
