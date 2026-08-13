# Windows User Runtime Stability Design

## Goal

Ensure a user with Node.js 22 LTS can unpack the repository, follow `README.md`, run the local Harness, reach the health endpoint and Web UI, execute timeout-bounded shell tools, and stop the process without leaked descendants or locked workspaces.

## Confirmed failures

Fresh copies of commit `1f53a82` were installed with the officially checksummed Node.js 22.23.2 Windows portable runtime. Two user-relevant lifecycle failures were reproduced outside the Codex sandbox:

- `execute_shell` returned after its `cmd.exe` wrapper timed out while a descendant Node process still held the working directory, so immediate cleanup failed with `EBUSY`.
- the packed CLI printed `Server starting at ...` before the HTTP listener was ready; `/api/health` remained unavailable for the test window because `startServer()` returned immediately after calling `app.listen()` instead of awaiting the listening event.

The first cold full-suite run also exposed test-only timing pressure. Timeout values may be adjusted only after the production lifecycle defects are fixed and measured; increasing timeouts alone is not an acceptable solution.

## Design

### Shell timeout lifecycle

Keep the public `createExecuteShellTool(workspaceRoot, { timeout })` interface unchanged. On Windows, replace the implicit `exec` timeout with an explicit timer that terminates the exact shell PID and its descendants using `taskkill /PID <pid> /T /F`. The tool must wait for both the command callback and tree-termination command before resolving. On non-Windows systems, retain Node's existing timeout behavior.

The timeout result remains unsuccessful and contains captured stdout, stderr, and a non-zero or null exit code. No user command text is interpolated into the cleanup command.

### Server readiness lifecycle

Keep `startServer(): Promise<HarnessApp>` unchanged for callers. Resolve the promise only when the HTTP server emits its successful listening callback. Reject on a pre-listening server error and close application resources before returning the error. This makes the CLI's existing `await startServer()` a real readiness barrier; only after it resolves may the CLI print the usable URL or attempt to open a browser.

### Tests and timing

Strengthen the shell timeout regression so Windows must report failure and the workspace can be removed immediately after `execute()` returns. Strengthen the server regression so the `startServer()` promise is demonstrably pending before the listening callback and resolved afterward.

Retain packed-tarball installation, health JSON, config status, Web UI and port-closure assertions. If the corrected product still exceeds the current cold-start budgets on an ordinary Windows machine, increase only the integration-test budgets with measured evidence and without weakening any assertion.

## Out of scope

- Changing command authorization, API-key storage, public/local security boundaries, output persistence, or network exposure.
- Adding a new process-management dependency.
- Treating the static GitHub Pages demo as a deployed full server.
- Including `submission.jsonc` in Git or in the source ZIP.

## Acceptance criteria

- On Windows Node.js 22, a timed-out shell command leaves no descendant holding its workspace.
- `startServer()` resolves only after loopback HTTP listening is ready and rejects binding errors.
- Packed CLI serves `/api/health`, `/api/config/status`, and the Web UI, then releases its port.
- `npm.cmd test`, `npm.cmd run build`, type checking, package verification and documentation checks exit zero in the final source tree.
- A newly archived source ZIP reproduces the verified commit; `submission.jsonc` remains its sibling.

## Approval

The user clarified that the objective is reliable use by other people and approved implementation of the recommended production-lifecycle fixes rather than test-only suppression.
