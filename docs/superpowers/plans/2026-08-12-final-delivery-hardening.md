# Final Delivery Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Each task requires a fresh subagent, RED → GREEN → refactor, spec review, code-quality/security review, and an atomic commit.

**Goal:** Deliver a locally trusted Coding Agent Harness through a verifiable npm tarball Release, with deterministic governance, memory, feedback, credential, documentation, and cold-start evidence.

**Architecture:** Keep the existing Core/Server/CLI monorepo and public-demo boundary. Make Governance authoritative over registered tool risk, inject a project-scoped MemoryStore into AgentLoop, and make the feedback demo select its next action from observed structured feedback. Publishable package metadata must resolve installed artifacts without monorepo-relative paths; the CLI starts the installed Server on loopback.

**Tech Stack:** TypeScript, Node.js 22 in CI, npm workspaces, Vitest, tsup, Express, Vite, sql.js, scrypt, AES-256-GCM.

## Global Constraints

- Work only in `D:\CodingAgentHarness\.worktrees\final-delivery` on branch `codex/final-delivery`; never edit `master`.
- Do not publish to npm, create a GitHub Release, push, or synchronize NJU Git without explicit user authorization for that exact action.
- Do not use real credentials. Use deterministic sentinel values only; redact output.
- Every task must record exact RED output before implementation and exact GREEN output after implementation.
- Every task receives spec-compliance review, then code-quality/security review; review findings require another RED → GREEN cycle.
- Preserve historical deviations honestly; do not fabricate pre-implementation cold-start or worktree evidence.
- Do not rewrite `REFLECTION.md`; provide the student only a factual/word-count correction list.

---

### Task 1: Wire dangerous tool risk into Governance/HITL

**Files:**
- Modify: `packages/core/src/guardrail/index.ts`, `packages/core/src/guardrail/guardrail.ts`, `packages/core/src/tools/tool.ts`
- Test: `packages/core/test/guardrail/integration.test.ts`, `packages/core/test/tools/tool.test.ts`

**Interfaces:**
- `ToolRegistry.execute(call, context)` must consult the registered tool metadata before execution.
- Governance must expose one deterministic decision path that can return an HITL block for `riskLevel: "dangerous"` even when command text is otherwise safe.

- [ ] Write a failing test registering a harmless-command tool with `riskLevel: "dangerous"`; assert execution is blocked and an approval request/state is emitted.
- [ ] Run `npm test --workspace @harness/core -- guardrail integration` and capture the exact failure showing the dangerous tool currently completes.
- [ ] Implement the smallest risk-aware dispatch change while preserving public/local policy and existing regex guardrails.
- [ ] Run the focused tests and assert GREEN, then run the full Core suite.
- [ ] Refactor only if the decision path remains duplicated; keep the risk policy in Governance/dispatch boundaries.
- [ ] Commit `fix: enforce dangerous tool approval in governance`.

### Task 2: Make MemoryStore project-scoped and inject it into AgentLoop

**Files:**
- Modify: `packages/core/src/memory/memory-store.ts`, `packages/core/src/loop/agent-loop.ts`, `packages/core/src/loop/context-builder.ts`, related exported types
- Test: `packages/core/test/memory/memory-store.test.ts`, `packages/core/test/loop/agent-loop.test.ts`, `packages/core/test/loop/context-builder.test.ts`

**Interfaces:**
- Memory queries and writes use an explicit `projectPath` (or the existing canonical project identity type).
- AgentLoop options accept a MemoryStore dependency; existing callers may use an explicit in-memory default only where tests require it.
- ContextBuilder receives a bounded, project-filtered memory list.

- [ ] Write a failing test inserting identical keywords for two project paths and assert a search for project A never returns project B.
- [ ] Run the focused memory test and capture the current cross-project result.
- [ ] Write a failing AgentLoop/context test asserting a matching project memory appears in the LLM request while another project memory does not.
- [ ] Implement SQL/project filtering, dependency injection, bounded retrieval, and context propagation with the smallest compatible API change.
- [ ] Run focused tests, then Core tests; capture GREEN counts.
- [ ] Refactor only duplicated project identity plumbing.
- [ ] Commit `fix: scope memories to agent projects`.

### Task 3: Prove feedback changes the next mock-LLM action

**Files:**
- Modify: `packages/core/src/loop/context-builder.ts` and/or feedback integration seam; `packages/core/src/llm/mock.ts` only if needed for an observable adapter contract
- Test: `packages/core/test/demo/feedback-demo.test.ts`, `packages/core/test/demo/deep-demo.test.ts`, possibly `packages/server/test/demo/public-demo-runner.test.ts`

**Interfaces:**
- The mock adapter records received contexts and selects a response based on a structured feedback field (not unconditional FIFO ordering).
- The scenario exposes first action, failed result, actionable fix, and changed second action for assertions.

- [ ] Write a failing deterministic test where the first response causes a known failed test and the second response is available only when the actionable fix is present in the next request.
- [ ] Run the test and capture failure proving the current demo does not establish feedback causality.
- [ ] Implement the smallest feedback-to-context wiring and mock response selector; preserve the existing public demo allowlist.
- [ ] Run the focused demo tests and assert the second action differs because of the observed feedback.
- [ ] Run all Core/Server demo tests and refactor only duplicated scenario setup.
- [ ] Commit `test: prove feedback-driven action correction`.

### Task 4: Repair installed package metadata and CLI runtime resolution

**Files:**
- Modify: `packages/core/package.json`, `packages/server/package.json`, `packages/cli/package.json`, `packages/cli/src/cli.ts`, package build configs as required
- Test: new `packages/cli/test/installed-runtime.test.ts` or an equivalent scripted integration test

**Interfaces:**
- `@harness/server` exposes a stable installed runtime entry and includes built client assets.
- `@harness/cli` resolves the installed server package through package metadata, never a monorepo-relative fallback.
- `harness` starts the server on `127.0.0.1` by default; an explicit development command remains documented separately.

- [ ] Write a failing integration test that packs the packages, installs them into a clean temporary directory, invokes `harness`, and asserts no `MODULE_NOT_FOUND` or missing `npm start` script.
- [ ] Run it against the current tree and record the exact failure.
- [ ] Implement package `main`/`exports`/files metadata, dependency version strategy, CLI start behavior, and asset inclusion.
- [ ] Run the clean-install test, then package builds and package-specific tests.
- [ ] Refactor only duplicated path/port handling; keep installed and monorepo paths covered separately.
- [ ] Commit `fix: make installed cli resolve server package`.

### Task 5: Add tarball and localhost credential lifecycle verification

**Files:**
- Create: `scripts/verify-tarball-install.mjs` (or project-approved equivalent)
- Modify: package scripts and `README.md` only for commands proven by the script
- Test: script assertions plus existing `packages/server/test/credential-store.test.ts`

**Interfaces:**
- The verifier creates an isolated temp directory, installs only the generated tarball, starts `harness` on an ephemeral loopback port, polls `/api/health`, and terminates the child process in `finally`.
- Credential checks use fake sentinel key/password values and assert status responses never contain plaintext.

- [ ] Write the verifier assertions first and run them against the current package; capture the expected failure(s).
- [ ] Implement tarball inspection, clean installation, startup, health/WebUI check, and initialize/status/update/lock/unlock/clear checks.
- [ ] Run the verifier twice from fresh directories; capture exit codes and redacted output.
- [ ] Run `npm pack --dry-run` and inspect actual tarball entries for `.env`, credentials, `node_modules`, workspace paths, and missing build output.
- [ ] Commit `test: verify clean tarball localhost lifecycle`.

### Task 6: Align README, SPEC, PLAN, SPEC_PROCESS, and AGENT_LOG

**Files:**
- Modify: `README.md`, `SPEC.md`, `PLAN.md`, `SPEC_PROCESS.md`, `AGENT_LOG.md`
- Do not modify: `REFLECTION.md` except a separately approved factual errata patch; do not generate prose for the student.

**Interfaces:**
- All documents describe localhost local-trusted delivery, deterministic public demo, tarball Release, and no public BYOK.
- SPEC uses actual `sql.js`, removes unverified cloud URLs/claims, and describes module inputs/outputs/boundaries/errors.
- PLAN contains one consistent status/commit table; historical deviations are explicitly labeled.
- AGENT_LOG records actual task, skill, prompt/context, commit, human intervention, and lesson evidence for this hardening cycle.

- [ ] Add a documentation consistency test/script that scans for stale cloud/public-BYOK claims, unresolved URLs, contradictory `pending` status, TODO/TBD, and mojibake; run it to capture current failures.
- [ ] Update only claims supported by repository evidence and the approved design; remove or label unverified deployment examples.
- [ ] Run the scan and manually inspect all changed sections.
- [ ] Commit `docs: align final local delivery contract`.

### Task 7: Strengthen CI and reproducible verification commands

**Files:**
- Modify: `.github/workflows/ci.yml`, `.gitlab-ci.yml`, root `package.json`, verification scripts
- Test: CI YAML/config inspection and local command execution

**Interfaces:**
- Both CI definitions retain a `unit-test` job.
- GitHub Actions uses `npm ci`, runs tests, build, and pack/entry checks on the declared push/PR branches.
- GitLab keeps the required unit-test job and includes the same build/pack verification where runner constraints allow.

- [ ] Write a failing config assertion that expects build and pack checks in both CI paths while preserving `unit-test`.
- [ ] Run the assertion against current CI and record the missing-step failure.
- [ ] Implement the smallest CI/script changes; do not add secrets or external publish steps.
- [ ] Run all local commands and validate YAML text/branch triggers.
- [ ] Commit `ci: verify builds and package artifacts`.

### Task 8: Final verification, student-only reflection checklist, and release readiness

**Files:**
- Modify only if required by verification: `AGENT_LOG.md`, `PLAN.md`, `README.md`
- Review only: `REFLECTION.md`, `C:\Users\sherr\Downloads\CodingAgentHarness-submission\submission.jsonc`

**Interfaces:**
- Final evidence records commands, exit codes, test/build counts, tarball hash/contents, and commit hashes.
- Submission template is not changed to `is_deployed=false` until a real Release URL exists.

- [ ] Run full Core/Server/CLI tests, production builds, demo tests, credential/placeholder scans, history secret scan, and clean tarball verifier.
- [ ] Run code-quality/security review and resolve every Critical/Required finding with another RED → GREEN cycle.
- [ ] Review `REFLECTION.md` only for 1500–2500 Chinese-character range, factual accuracy, structure, typos, and author-owned edits; return a checklist to the student.
- [ ] Record the final verification evidence and current commit hash in AGENT_LOG/PLAN.
- [ ] Stop before any push, npm publish, GitHub Release, or submission-template URL change; request exact external authorization.
- [ ] Commit `chore: record final delivery verification`.

## Review gates between tasks

After each task:

1. Run the task's focused tests and the affected package suite.
2. Perform spec-compliance review against the design and this plan.
3. Perform code-quality/security review across correctness, readability, architecture, security, and performance.
4. If a Critical/Required finding exists, write a regression test, capture RED, fix minimally, capture GREEN, and re-review.

## Final evidence required before any external release action

- Branch/worktree path and final commit hash.
- Core/Server/CLI test counts and exit codes.
- Build and pack outputs.
- Clean-directory install/start/WebUI/credential lifecycle results.
- Mechanism demo results for HITL, feedback causality, and project-scoped memory.
- Secret/placeholder scan summary without printing secret values.
- Student-authored REFLECTION correction checklist.
- Exact proposed Release URL and exact external action awaiting authorization.
