# Task 2 Report: Project-scoped memories

## Scope and files

- `packages/core/src/memory/memory-store.ts`
  - Made `search` require `projectPath`, and bound it in the parameterized SQL query.
  - Preserved the required `MemoryEntry.projectPath` during writes without an empty-path fallback.
- `packages/core/src/loop/agent-loop.ts`
  - Added the `MemoryStore` dependency and retrieves at most 10 matching memories for the run's `workingDir` before context construction.
- `packages/core/test/memory/memory-store.test.ts`
  - Updated search callers and added a same-keyword cross-project isolation regression test.
- `packages/core/test/loop/agent-loop.test.ts`
  - Added an LLM-context regression test proving the loop requests project A memories and omits project B content; existing tests receive an explicit empty store.
- `packages/server/src/agent/privileged-agent-run.ts`
  - Injected a lazy, persistent per-workspace MemoryStore at `.harness-memories.db` for the existing production AgentLoop caller.
- `packages/server/test/agent/privileged-agent-run.test.ts`
  - Added a production-call-path regression test for successful AgentLoop startup with a project-scoped memory store.

## TDD evidence

RED:

- `npm.cmd run test --workspace=@harness/core -- test/memory/memory-store.test.ts`
  - 8 tests total: 4 failed. New project-path calls returned no results because the old signature interpreted the path as the query.
- `npm.cmd run test --workspace=@harness/core -- test/loop/agent-loop.test.ts`
  - 20 tests total: 1 failed. Expected `search('/project/a', 'Use project memory', { limit: 10 })`; observed 0 calls.
- `npm.cmd run test --workspace=@harness/server -- test/agent/privileged-agent-run.test.ts`
  - 1 test failed with `LLMProviderError: LLM_PROVIDER_ERROR`, proving the existing server caller lacked `memoryStore`.

GREEN:

- Focused Core: `test/memory/memory-store.test.ts`, `test/loop/agent-loop.test.ts`, and `test/loop/context-builder.test.ts`: 3 files, 35 tests passed.
- Core full suite: 31 files, 294 tests passed.
- Core build: `npm.cmd run build --workspace=@harness/core` passed, including DTS output.
- Server focused integration test: 1 file, 1 test passed.
- Server build: `npm.cmd run build --workspace=@harness/server` passed.

## Refactor and spec self-review

- No duplicated project-identity plumbing remained to extract: `workingDir` is the single AgentLoop project identity and the MemoryStore owns SQL filtering.
- Search and write APIs now carry a required project identity.
- AgentLoop no longer hard-codes `memories: []`; it passes the bounded result to ContextBuilder.
- Project boundaries are enforced by parameterized `project_path = ?` SQL, including same-keyword entries.
- Existing test callers remain operational through an explicit empty MemoryStore test double; the Server production caller receives a real persistent store.
- The change adds no credentials, publishes nothing, and makes no unrelated fixes.

## Review and concerns

- Independent review found and this change fixed the missing Server production dependency noted above.
- `npx.cmd tsc --noEmit --project packages/server/tsconfig.json` remains red only on pre-existing, unrelated Server issues: SessionHistory status comparison, credential-store KDF literal typing, and several older test fixtures missing newer `CredentialStore`/`RuntimeSession` fields. The new privileged-agent-run test has no remaining type error.
- The memory database is intentionally stored inside the ephemeral, server-issued workspace. It persists for the lifetime of that workspace and is removed with it; cross-project retrieval is still prevented by project-path query filtering.

## Commit

- Atomic commit: `fix: scope memories to agent projects`.
