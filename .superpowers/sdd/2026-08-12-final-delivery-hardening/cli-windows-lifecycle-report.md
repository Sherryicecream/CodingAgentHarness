# CLI Windows lifecycle hardening report

## Status

The locally packed CLI now completes its Windows install/start/health/WebUI/shutdown lifecycle. The full `@harness/cli` suite completes in 18.1 seconds with 3/3 passing, without `DEP0190`, an orphan server, an occupied test port, or retained test temp directories.

## Root cause

Two nested shell/process boundaries combined to hide the real failure:

1. The test invoked `npm.cmd` through `spawnSync(..., { shell: true })`. A fresh per-test npm cache forced registry requests; under the restricted run they repeatedly failed with `EACCES`. The 50-second timeout terminated the Windows shell wrapper, but its npm child retained the synchronous pipes, so Node emitted no TAP output and the outer suite stayed silent beyond 100 seconds. The shell invocation also caused Node's `DEP0190` warning.
2. Once npm execution was made observable, the packed CLI exposed the product lifecycle bug. `cli.ts` used `exec('node ...server.js')`, adding another `cmd.exe` layer. Killing the CLI wrapper did not own or close the actual server process; PID 19940 continued listening on `127.0.0.1:31955` after its parent had exited.

The CLI also inherited the server's safe public default and non-production asset mode. For the locally executable CLI contract it must default to `HARNESS_MODE=local` and `NODE_ENV=production`, while preserving values explicitly supplied by the caller.

## TDD evidence

### RED: silent npm child

Command (working directory `packages/cli`):

```text
node --test --test-name-pattern "packed CLI node entry" test/installed-runtime.test.mjs
```

The command produced no TAP output and was terminated after more than 100 seconds. Its owned temp npm log showed `npm install` repeating registry `EACCES` attempts after the test's 50-second timeout. Read-only process inspection found the surviving npm child PID 41028.

### RED: orphaned installed server

After switching the harness to npm's JavaScript entry (no `shell: true`) and using the normal local cache, the same packed lifecycle reached health/WebUI then failed cleanup. Process/listener evidence showed:

```text
ProcessId: 19940
ParentProcessId: 9716 (already exited)
CommandLine: node ...\harness-installed-kpyAsX\node_modules\@harness\server\dist\server.js
Listener: 127.0.0.1:31955 owned by PID 19940
```

Those two verified processes and only their owned temp directories were forcibly removed before implementation continued.

### Intermediate contract REDs

The focused test then reported health `{ status: 'ok', mode: 'public' }` instead of local, followed by WebUI status `404` instead of `200`. These proved the CLI needed explicit local and production defaults.

### GREEN

Command:

```text
node --test --test-name-pattern "packed CLI node entry" test/installed-runtime.test.mjs
```

Exit `0` in 15.6 seconds: 1 passed, 0 failed. It packed and freshly installed all three local tarballs, ran the installed JavaScript bin with fake/no credentials, received `/api/health` `200` with `{ status: 'ok', mode: 'local' }`, received `/` `200` with the packaged React root, killed the CLI, observed the port close, and removed both temp directories.

## Minimal fix and refactor

- `packages/cli/src/cli.ts`: start `@harness/server` in the CLI process with its exported `startServer()` instead of an `exec`/shell child. Default `HARNESS_MODE` to `local` and `NODE_ENV` to `production` with `??=` so explicit caller values remain authoritative.
- `packages/cli/test/installed-runtime.test.mjs`: retained the pre-existing user lifecycle assertions and cleanup work; run npm's JS entry through `process.execPath`, avoiding `shell: true` and `DEP0190`; prefer the local npm cache with audit disabled; retain bounded install/start/port-close waits and final temp cleanup.

No assertion was weakened and no lifecycle was faked. No credentials, master edit, publish, push, PR, Release, deployment, `REFLECTION.md`, or `artifacts/` change occurred.

## Fresh verification

| Command | Exit/result |
| --- | --- |
| focused packed CLI command above | `0`; 1/1 passed; 15.6 s |
| `npm.cmd test --workspace @harness/cli` | `0`; 3/3 passed; 18.1 s |
| `npm.cmd run build` | `0`; CLI, Core JS/DTS, Server JS and Vite client built |
| `npm.cmd run verify:packages` | `0`; Core 3, Server 9, CLI 2 files; entries verified |
| `npm.cmd test --workspace @harness/server -- test/app.test.ts test/security/runtime-policy.test.ts` | `0`; 2 files, 7/7 passed |
| `git diff --check 5faeb2f -- packages/cli/src/cli.ts packages/cli/test/installed-runtime.test.mjs` | `0` |

Final read-only inspection found no Node command line containing `harness-installed-`/`harness-packed-`, no listener in ports 31000-31999, and no matching temp directory created in the preceding ten minutes.

## Concerns

The packed integration is a real npm install and therefore still requires either a sufficiently populated local npm cache or registry access for public transitive dependencies. `npm_config_prefer_offline=true` minimizes that dependency without turning the test into a mock. The regression uses random ports in 31000-31999, so the small pre-bind race documented in Task 8 remains unchanged.

## Review fix: observable natural shutdown and isolated cleanup

Review found that the first fix's test cleanup could hide the exact orphan it claimed to detect: it called `child.kill()` and immediately ran `taskkill /t /f`, so a descendant server could be forcibly removed before the port-close assertion. It also skipped directory removal if lifecycle cleanup threw, and the installed CLI inherited credential-bearing environment variables while using the real default credential location.

### RED

A controlled Windows fixture launched a CLI-like wrapper with a descendant loopback HTTP server and asserted that normal wrapper termination must reject while the descendant remained listening:

```text
node --test --test-name-pattern "Windows cleanup reports" test/installed-runtime.test.mjs
```

Against immediate `taskkill`, exit was `1` in 1.2 seconds: 0/1 passed. The exact failure was `AssertionError: Missing expected rejection` because forced tree termination erased the listener before the assertion. After the natural-exit implementation, the fixture was made explicitly detached so Windows consistently preserved the intended orphan; the focused test then passed and its own finalizer removed the fixture server.

A second focused RED injected only the fake sentinel `sk-fake-parent-environment-regression-only` into the would-be inherited CLI environment. The packed test exited `1` in 21.9 seconds because `/api/config/status` returned:

```text
{ hasKey: true, source: 'env', state: 'empty' }
```

instead of the required fake-only empty state.

### GREEN and refactor

- `stopProcessTree` now sends normal termination, waits for the actual child exit, then requires three consecutive failed loopback requests before accepting port closure.
- Only a timeout/error triggers best-effort `taskkill /t /f` (or `SIGKILL` off Windows), after which the original lifecycle error is rethrown.
- `cleanupPackedRuntime` records lifecycle failure, always runs both directory removals with `Promise.allSettled`, and returns cleanup failure without replacing an earlier test-body failure.
- The controlled orphan regression verifies both the lifecycle rejection and removal of its packed/install directories.
- The packed child filters inherited names containing API/access keys, tokens, secrets, passwords, credentials, or authorization, and pins `HARNESS_CREDENTIALS_FILE` below `installDirectory`. Its fake inherited sentinel is absent from `/api/config/status`, and the temporary credential file remains absent.

Focused command:

```text
node --test --test-name-pattern "Windows cleanup reports|packed CLI node entry" test/installed-runtime.test.mjs
```

Exit `0` in 54.8 seconds: 2/2 passed. The real packed install accounted for 52.1 seconds on that run; the subsequent cached full suite was faster.

Fresh final verification:

| Command | Exit/result |
| --- | --- |
| `npm.cmd test --workspace @harness/cli` | `0`; 4/4 passed; 19.6 s |
| `npm.cmd run build` | `0`; CLI, Core JS/DTS, Server JS and Vite client built |
| `npm.cmd run verify:packages` | `0`; Core 3, Server 9, CLI 2 files; entries verified |
| `npm.cmd test --workspace @harness/server -- test/app.test.ts test/security/runtime-policy.test.ts` | `0`; 2 files, 7/7 passed |
| `git diff --check 6c38022` | `0` |

Final inspection found no matching Node process, listener on ports 31000-31999, or recent `harness-installed-*`, `harness-packed-*`, or `harness-orphan-*` temp directory. `artifacts/` remained untouched. No real credential, `REFLECTION.md`, external operation, push, PR, publication, or release was used.
