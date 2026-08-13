# Task 2 Fix Round 2 Report: Cross-project delete regression coverage

## Change

- Enhanced `packages/core/test/memory/memory-store.test.ts` only.
- The regression now passes project A and project B's actual memory id to `delete('/project/a', entryB.id)`, then verifies both A and B records remain. This directly exercises the cross-project delete-bypass attempt.
- The existing delete SQL implementation remains unchanged: `WHERE id = ? AND project_path = ?`.

## TDD evidence

- RED proof: temporarily changed the delete SQL to the legacy id-only predicate and ran:
  - `npm.cmd run test --workspace=@harness/core -- test/memory/memory-store.test.ts -t "should not delete a different project's memory when given its id"`
  - Result: 1 failed, 8 skipped. Project B's record was deleted, so the B-presence assertion failed.
- GREEN after restoring the project-path predicate:
  - MemoryStore focused suite: 1 file, 9 tests passed.
  - Core full suite: 31 files, 295 tests passed.

## Self-review

- The test now demonstrates the precise authorization-bypass input, rather than merely deleting an A-owned id.
- No production code, dependencies, credentials, or external state changed in this round.

## Concerns

- None.

## Commit

- Atomic commit: `test: cover cross-project memory deletion`.
