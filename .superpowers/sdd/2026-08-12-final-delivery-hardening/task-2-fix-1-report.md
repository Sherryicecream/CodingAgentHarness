# Task 2 Fix Round 1 Report: Project-scoped deletion

## Change

- `packages/core/src/memory/memory-store.ts`
  - Changed deletion to `delete(projectPath, id)`.
  - Uses `DELETE FROM memories WHERE id = ? AND project_path = ?` with bound parameters.
- `packages/core/test/memory/memory-store.test.ts`
  - Updated the existing delete caller.
  - Added a regression test proving deletion from project A removes only A's entry and leaves project B's entry intact.
- `packages/server/src/agent/privileged-agent-run.ts`
  - Updated the lazy MemoryStore adapter to forward `delete(projectPath, id)`.

## TDD evidence

- RED: `npm.cmd run test --workspace=@harness/core -- test/memory/memory-store.test.ts`
  - 9 tests total: 2 failed. The old one-argument delete treated `/project/a` as the id, so project A's record remained.
- GREEN focused:
  - MemoryStore: 1 file, 9 tests passed.
  - Server privileged-agent integration: 1 file, 1 test passed.
- Full verification:
  - Core: 31 files, 295 tests passed.
  - Core build: `npm.cmd run build --workspace=@harness/core` passed, including DTS generation.

## Self-review

- Delete now requires explicit project identity at the public MemoryStore boundary.
- The SQL predicate validates both record identity and project identity; a caller from one project cannot delete another project's record even if it knows that id.
- The only production adapter forwarding this API was updated; no unrelated changes were made.
- No credentials, secrets, publishing, or other external state changes were introduced.

## Concerns

- None for this focused change.

## Commit

- Atomic commit: `fix: scope memory deletion to projects`.
