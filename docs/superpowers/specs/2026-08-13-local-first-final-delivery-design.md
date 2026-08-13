# Local-First Final Delivery Design

**Date:** 2026-08-13

**Status:** Awaiting student review

## 1. Goal

Finish Coding Agent Harness without operating a cloud backend. The submitted product has two explicit surfaces:

1. a static, credential-free WebUI demonstration published through GitHub Pages; and
2. a complete local application started by the CLI and bound only to a loopback address.

The same final-delivery work also simplifies API credential handling and gives generated files an explicit, durable export path.

## 2. Delivery boundary

### 2.1 Static demonstration

The online URL required by the course points to a static site. It runs a deterministic Mock LLM scenario entirely in the browser and demonstrates:

- an Agent decision;
- a safe tool event;
- a dangerous action blocked by Governance;
- an injected test failure;
- structured feedback entering the next iteration;
- a different Mock LLM action after that feedback; and
- a final passing test result.

The static bundle must not contain credential forms, real-LLM adapters, local configuration APIs, Shell/Git/process tools, session persistence APIs, or arbitrary server endpoints. It is a mechanism demonstration, not the complete product.

### 2.2 Local complete application

The complete WebUI is served by the locally installed Harness process. The CLI binds the server to `127.0.0.1` by default and opens the browser. Real LLM calls, project files, Shell, Git, tests, memory, credentials, and artifact export exist only in this local boundary.

The project will not document or support a remotely exposed `local` mode. The previous hosted-Express interpretation of `public` mode is removed from the final product description.

## 3. Credential model

### 3.1 User-visible choices

The configuration experience exposes only two choices:

- **Use for this run:** keep the DeepSeek API Key in memory until the run finishes, fails, is cancelled, or the page is unloaded.
- **Remember on this device:** store the DeepSeek API Key in the current operating-system user's credential store.

The course version supports DeepSeek as the configured provider. The generic provider-management UI and incomplete `providerId` execution path are removed. `LLMAdapter` remains the extension seam for future providers.

### 3.2 Persistent backend

The persistent implementation uses `@napi-rs/keyring` with service `CodingAgentHarness` and account `deepseek-api-key`. Its platform backends are Windows Credential Manager, macOS Keychain, and Linux Secret Service.

The keyring module is loaded behind a small injected interface so tests never access a developer's real credential store. If the native backend is missing, locked, or unavailable, the application reports that persistent storage is unavailable and continues to offer memory-only use. It must never fall back to a plaintext file or a machine-derived encryption key.

### 3.3 Removed concepts

The following product concepts are deleted rather than preserved as compatibility layers:

- Harness master-password setup and confirmation;
- encrypted credential files;
- locked, unlocked, legacy, and initialized-without-a-key states;
- generic provider records containing keys;
- master-password unlock and migration routes.

Old encrypted files are not automatically opened or migrated. Documentation instructs users of the development version to clear the old local file and enter the Key again. The product must not read the old file during normal startup.

### 3.4 API and security contract

The local status API returns only:

```ts
interface CredentialStatus {
  storage: 'memory' | 'keyring' | 'unavailable';
  hasKey: boolean;
}
```

It never returns a Key. Set, test, update, and delete operations redact secrets from logs and errors. Deleting a remembered Key removes the operating-system credential. Environment credentials remain an explicit non-interactive operator input and are reported only as `hasKey: true`; they are never copied into the keyring automatically.

## 4. Generated-file ownership

### 4.1 Three separate concepts

- **Session workspace:** an isolated temporary directory where the Agent works.
- **Artifact set:** files created or modified by successful `write_file` calls in one session.
- **Project root:** the user-controlled local project selected when Harness starts.

Saving artifacts and preserving an entire temporary workspace are no longer treated as the same operation.

### 4.2 Artifact tracking

Each successful write records a relative path, operation (`created` or `modified`), byte size, SHA-256 digest, timestamp, and tool-call ID. The record is scoped to the session and excludes files outside the issued workspace.

At the end of a run, the WebUI lists the complete artifact set. The user does not manually guess and type individual file paths.

### 4.3 Durable export

The default **Export artifacts** action copies the complete artifact set to:

```text
<project-root>/.harness/outputs/<session-id>/
  files/<original-relative-path>
  manifest.json
```

`manifest.json` records the task, session ID, export timestamp, source-relative paths, operations, sizes, digests, and final test result. Export uses a staging directory followed by an atomic directory rename. A failed export must not leave a directory that appears complete.

Exported outputs are durable and are never removed by the session sweeper. Temporary workspaces remain reclaimable after their documented expiry.

### 4.4 Applying changes to the project

**Apply to project** is separate from export. Before applying, the WebUI shows the affected paths and diffs. Existing-file replacement is classified as a dangerous action and requires one-time HITL approval bound to the immutable artifact manifest.

The apply operation rejects absolute paths, `..`, symlinks, non-regular files, `.git`, paths outside the selected project root, and any source whose digest no longer matches the manifest. Existing targets are not overwritten without explicit approval. Writes use same-directory temporary files and atomic replacement where supported.

The first implementation milestone may ship export without apply. Export is the course-delivery requirement; apply is implemented only after export, cleanup, and security tests pass.

## 5. Component boundaries

### Server

- `credential-store.ts` becomes an OS-keyring adapter with an injected backend.
- credential routes expose the small memory/keyring lifecycle and no master-password lifecycle.
- artifact tracking is a session-owned service rather than logic embedded in the route.
- artifact export is a focused service called by a thin route.

### Client

- the configuration page becomes a linear DeepSeek setup flow.
- the chat result view consumes an artifact manifest and exposes one Export action.
- static-demo components live in a separate browser-only entry and do not import the local configuration or execution client.

### Core

The Harness loop, Governance, FeedbackLoop, Mock LLM, memory, and tool abstractions remain the product core. Server code must consume `@harness/core` public exports instead of importing `packages/core/src` internals.

## 6. Error behavior

- Keyring unavailable: show a non-secret diagnostic and offer memory-only use.
- Keyring write/delete rejected: preserve the previous credential state and report failure.
- LLM connection test fails: distinguish invalid credential, upstream response, timeout, and local network failure without echoing the Key.
- Artifact export conflict: do not merge with an existing completed export; offer a new export identifier.
- Artifact source changed after manifest creation: reject export/apply and ask the user to refresh the artifact list.
- Partial export: remove the staging directory; keep the session workspace available for retry.
- Static demo error: reset the deterministic scenario locally; never call a fallback server.

## 7. Testing strategy

All behavioral work follows red-green-refactor.

Credential tests use an in-memory fake keyring and cover save, update, status, delete, unavailable backend, environment precedence, memory cleanup, and secret redaction. No automated test may touch the real OS credential store; a separately documented manual smoke test verifies Windows Credential Manager.

Artifact tests cover nested directories, multiple files, hashes, binary data, conflicts, traversal, symlinks, atomic failure cleanup, session cleanup after export, and durable output survival. Route and WebUI tests assert the complete manifest-driven workflow.

Static-demo tests build the browser entry and inspect its dependency closure. They prove that no credential route, real LLM adapter, process tool, or local persistence module enters the bundle. Browser tests replay the full deterministic mechanism scenario.

The final CI order is install, typecheck, unit/integration tests, production build, package verification, static-demo build, and static-bundle boundary verification.

## 8. Ordered delivery

1. Restore a green baseline: fix current Server tests, type errors, and CLI lifecycle timeout.
2. Replace the credential lifecycle with memory/keyring storage and remove generic Provider behavior.
3. Implement manifest-driven artifact tracking and durable export.
4. Add guarded apply-to-project only after export is verified.
5. Extract and publish the browser-only static demonstration.
6. Verify clean package installation and create real release artifacts.
7. Align SPEC, PLAN, SPEC_PROCESS, AGENT_LOG, README, and the student-authored reflection.
8. Require a passing final CI run and manually verify the static URL and local application.

## 9. Acceptance criteria

- No cloud backend is needed for the submitted online demonstration.
- The online URL works as a static Mock LLM mechanism demo and contains no credential or privileged execution path.
- The local WebUI starts through the installed CLI and binds to loopback.
- A Key can be memory-only or stored in the OS credential manager; no Harness master password or credential file remains.
- Credential status, update, test, and clear work without returning or logging the Key.
- All generated files are listed without manual path entry and can be exported together with a verified manifest.
- Exported artifacts survive temporary workspace cleanup.
- Existing project files cannot be overwritten without a diff and one-time HITL approval.
- Typecheck, tests, build, package verification, and static-bundle checks pass in CI.

