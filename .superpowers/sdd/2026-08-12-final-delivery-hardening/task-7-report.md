# Task 7 Report

## Status

Task 7 adds reproducible CI build and dry-run package-entry verification to both CI providers. The focused CI contract test, workspace build, documentation tests, package verification, and independent YAML parse pass locally. The additional full root test did not complete within its 240-second bound and is not claimed as passing.

## Files

- `.github/workflows/ci.yml`: preserves the existing push and pull-request branches plus the `unit-test` job; uses `npm ci`, then test, build, and package verification.
- `.gitlab-ci.yml`: preserves `unit-test` and adds build and package verification after install and test.
- `package.json`: includes the CI contract test in the root test command and exposes `verify:packages`.
- `scripts/check-ci-config.test.mjs`: asserts the named jobs, GitHub branch triggers, ordered commands, and absence of publish/release/secret references.
- `scripts/verify-packages.mjs`: runs `npm.cmd pack --dry-run --json --ignore-scripts` for each workspace package using a temporary npm cache, verifies declared local `main`, `types`, `bin`, and `exports` entries are present, and removes the cache in `finally`.

## TDD evidence

### RED

Command:

```text
node --test scripts/check-ci-config.test.mjs
```

Exit code: `1`.

Exact output:

```text
✖ GitHub CI preserves triggers and verifies tests, builds, and packages (3.9829ms)
✖ GitLab CI preserves unit tests and verifies builds and packages (2.1241ms)
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 71.0327

✖ failing tests:

test at scripts\check-ci-config.test.mjs:19:1
✖ GitHub CI preserves triggers and verifies tests, builds, and packages (3.9829ms)
  AssertionError [ERR_ASSERTION]: GitHub CI must run npm ci in order
      at assertCommandsInOrder (file:///D:/CodingAgentHarness/.worktrees/final-delivery/scripts/check-ci-config.test.mjs:14:12)
      at TestContext.<anonymous> (file:///D:/CodingAgentHarness/.worktrees/final-delivery/scripts/check-ci-config.test.mjs:25:3)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at scripts\check-ci-config.test.mjs:33:1
✖ GitLab CI preserves unit tests and verifies builds and packages (2.1241ms)
  AssertionError [ERR_ASSERTION]: GitLab CI must run npm run build in order
      at assertCommandsInOrder (file:///D:/CodingAgentHarness/.worktrees/final-delivery/scripts/check-ci-config.test.mjs:14:12)
      at TestContext.<anonymous> (file:///D:/CodingAgentHarness/.worktrees/final-delivery/scripts/check-ci-config.test.mjs:37:3)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }
```

The failures were the intended missing CI commands, not syntax or fixture errors.

### GREEN

Command:

```text
node --test scripts/check-ci-config.test.mjs
```

Exit code: `0`.

Exact output:

```text
✔ GitHub CI preserves triggers and verifies tests, builds, and packages (3.4157ms)
✔ GitLab CI preserves unit tests and verifies builds and packages (0.7689ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 62.8651
```

## Proportional verification

| Command | Exit/result | Evidence |
| --- | --- | --- |
| `npm.cmd run build` | `0` | `@harness/cli`, `@harness/core`, and `@harness/server` built; server client Vite build completed. |
| `npm.cmd run test:docs` | `0` | 10 passed, 0 failed. |
| `npm.cmd run verify:packages` | `0` | `@harness/core`: 3 files; `@harness/server`: 9 files; `@harness/cli`: 2 files; all declared package entries verified. |
| `node -e "...YAML.parse..."` | `0` | Printed `Parsed .github/workflows/ci.yml and .gitlab-ci.yml; unit-test jobs present`. |
| `npm.cmd test` | terminated after exceeding 240 seconds | The command produced no captured output while yielded and remained running beyond the bound. It was explicitly terminated after approximately 280 seconds and is not claimed passing. |

The first successful package-verifier run emitted Node's `DEP0190` warning because it used `shell: true` on Windows. After GREEN, the verifier was refactored to invoke the fixed `npm.cmd pack --dry-run` command via `cmd.exe` without Node's shell option. The fresh rerun above exited `0` with no warning.

## Scope and concerns

- The full root test's existing CLI installed-runtime test remains a concern; Task 4 also documented the temporary package-install path timing out. Task 7 does not claim a clean installed-runtime proof.
- The full test generated `packages/server/.harness-memories.db`. Its exact resolved worktree path was verified, then that generated file was removed. No Task 7 command left new tarballs or package artifacts in the repository.
- The pre-existing dirty `packages/cli/test/installed-runtime.test.mjs` and pre-existing untracked `artifacts/` tarballs were neither modified nor staged by Task 7.
- Package verification is strictly dry-run and uses `--ignore-scripts`; it contains no publish command, credentials, secret references, release step, or repository mutation.
- No push, PR, release, npm publish, credential, or secret operation was performed.

