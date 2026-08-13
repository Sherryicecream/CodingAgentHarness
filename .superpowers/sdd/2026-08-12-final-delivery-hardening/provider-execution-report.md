# Configured provider execution seam report

## Status

Implemented a factory-only execution seam for locally configured providers. The seam reads one encrypted provider record by exact ID, validates that both the provider ID and endpoint are built-in allowlist entries, constructs an opaque disposable `LLMAdapter`, and accepts an injected fetch implementation for network-free tests.

No agent-run route or UI selection integration was added. That broader product/API decision is intentionally left for a later change rather than guessing how a configured provider should be selected by clients.

## Architecture found

- `packages/core/src/llm/adapter.ts` defines the existing `LLMAdapter` boundary.
- `packages/core/src/llm/deepseek.ts` is the only real adapter. It builds an OpenAI-compatible `/v1/chat/completions` request and clears its authorization header after fetch settles.
- `packages/server/src/provider-configuration.ts` stores versioned provider records, including the API key, through the encrypted `CredentialStore`; list responses expose summaries only.
- `packages/server/src/agent/privileged-agent-run.ts` still preserves the existing DeepSeek server-key and BYOK behavior.
- Public mode uses an in-process scripted demo and disables server credentials through `RuntimePolicy`.

## TDD evidence

### RED

After adding only `packages/server/test/provider-execution.test.ts`, this focused command was run:

```text
..\..\node_modules\.bin\vitest.cmd run test/provider-execution.test.ts
```

Exit `1`: the suite failed during import with `Cannot find module '../src/provider-execution.js'`. This was the expected failure because the configured-provider factory seam did not exist.

### GREEN

After the minimal implementation, the same focused command exited `0`: 1 file and 3/3 tests passed. The tests use the real encrypted credential store and real `DeepSeekAdapter`, replacing only external fetch. They verify:

- the `deepseek` record constructs the exact `https://api.deepseek.com/v1/chat/completions` request with its configured model;
- the credential exists in the authorization header only while injected fetch executes, the mutable header is cleared afterward, the resource does not serialize the secret, and the encrypted file contains no plaintext secret;
- releasing the resource disposes the credential-bearing adapter;
- a configured attacker URL is rejected before fetch;
- non-allowlisted provider IDs and configured endpoints are rejected before fetch;
- public mode rejects provider execution before credential access or fetch.

## Minimal implementation

- `packages/core/src/llm/deepseek.ts`: added optional `fetchImpl` dependency injection while retaining global `fetch` as the default. Existing constructor arguments and default DeepSeek URL/model are unchanged.
- `packages/server/src/provider-execution.ts`: added the local-only configured-provider resource factory. Its current explicit allowlist is only `deepseek` at `https://api.deepseek.com`. The configured model remains provider-owned, but the stored base URL cannot direct execution to another host. Decrypted serialized/provider references are dropped after construction, and `release()` disposes and removes the live adapter reference.
- `packages/server/test/provider-execution.test.ts`: added the focused encrypted-store/request/security tests.

The factory emits no logs and adds no dependency. Arbitrary stored HTTP/HTTPS URLs remain inert provider configuration rather than fetch targets. Public mode remains scripted and provider execution remains disabled.

## Review

A five-axis correctness, readability, architecture, security, and performance review found no required issue. An independent reviewer dispatch was attempted but could not start because all agent task slots were occupied. The direct review confirmed the change stays below the agent-run integration boundary, fails closed before credential access in public mode, uses exact allowlist matching, and preserves the existing DeepSeek API by making fetch injection optional.

## Verification

| Command | Result |
| --- | --- |
| focused configured-provider test | `0`; 1 file, 4/4 passed |
| focused core LLM tests | `0`; 2 files, 13/13 passed |
| focused server provider/config tests | `0`; 3 files, 23/23 passed |
| `npm.cmd test --workspace @harness/core` | `0`; 31 files, 297/297 passed |
| `npm.cmd test --workspace @harness/server` | `0`; 23 files, 208/208 passed |
| `npm.cmd run build --workspace @harness/core` | `0`; ESM and declarations built |
| `npm.cmd run build --workspace @harness/server` | `0`; server ESM and Vite client built |
| `npm.cmd run build` | `0`; CLI, Core JS/DTS, Server JS, and Vite client built |

## Scope and preservation

No network call used a real provider, and no plaintext production credential was used or logged. `artifacts/`, `REFLECTION.md`, `packages/server/.harness-memories.db`, existing generated output, master, remotes, and unrelated changes were not modified by this task.
