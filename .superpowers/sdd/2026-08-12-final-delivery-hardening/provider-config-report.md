# Generic Local Provider Configuration Report

## Outcome

Local mode now supports encrypted add/list/delete configuration for additional providers while preserving the original DeepSeek key API and UI. Public mode still rejects every `/api/config/*` request with `403 { "error": "CONFIG_DISABLED" }`. This slice stores configuration only; it does not create an outbound provider request path.

## Strict TDD Evidence

Baseline before test edits:

```text
Command: npm.cmd test --workspace @harness/server -- test/routes/config-policy.test.ts
Test Files  1 passed (1)
Tests       9 passed (9)
Exit code: 0
```

RED after adding the focused provider contract and public policy cases, before production edits:

```text
Command: npm.cmd test --workspace @harness/server -- test/routes/provider-config.test.ts test/routes/config-policy.test.ts
Test Files  1 failed | 1 passed (2)
Tests       8 failed | 12 passed (20)
Primary failure: expected 404 to be 201 at provider-config.test.ts:61
Validation failures: expected 404 to be 400 at provider-config.test.ts:101
Exit code: 1
```

The failures were the intended missing-contract failures: the fixed DeepSeek-only router had no provider collection endpoint.

First backend GREEN:

```text
Command: npm.cmd test --workspace @harness/server -- test/routes/provider-config.test.ts test/routes/config-policy.test.ts
Test Files  2 passed (2)
Tests       20 passed (20)
Exit code: 0
```

UI RED before the ConfigPage provider component existed:

```text
Command: npm.cmd test --workspace @harness/server -- test/client/provider-config.test.tsx
Test Files  1 failed (1)
Tests       1 failed (1)
Failure: Unable to find a label with the text of: Provider ID
Exit code: 1
```

UI GREEN:

```text
Command: npm.cmd test --workspace @harness/server -- test/client/provider-config.test.tsx
Test Files  1 passed (1)
Tests       1 passed (1)
Exit code: 0
```

Post-refactor affected verification:

```text
Command: npm.cmd test --workspace @harness/server -- test/routes/provider-config.test.ts test/routes/config-policy.test.ts test/client/provider-config.test.tsx test/client/public-modes.test.tsx
Test Files  4 passed (4)
Tests       46 passed (46)
Exit code: 0

Command: npm.cmd run build --workspace @harness/server
Server bundle: success
Client bundle: success
Exit code: 0
```

Full server verification before the final UI-only extraction was `22 passed` files and `197 passed` tests; the affected suites and build were rerun after that extraction as recorded above.

Review-fix RED for the bulk encrypted snapshot API:

```text
Command: npm.cmd test --workspace @harness/server -- test/credential-store.test.ts test/client/provider-config.test.tsx
Test Files  1 failed | 1 passed (2)
Tests       1 failed | 4 passed (5)
Failure: TypeError: store.getKeys is not a function at credential-store.test.ts:70
Exit code: 1
```

The locked-to-unlocked provider regression passed immediately because the provider UI extraction completed just before review already changed it to mount and fetch only after unlock. This is retained as regression coverage and is not misreported as RED.

Review-fix GREEN:

```text
Command: npm.cmd test --workspace @harness/server -- test/credential-store.test.ts test/client/provider-config.test.tsx test/routes/provider-config.test.ts test/routes/config-policy.test.ts
Test Files  4 passed (4)
Tests       25 passed (25)
Exit code: 0
```

Final full verification after review fixes:

```text
Command: npm.cmd test --workspace @harness/server
Test Files  22 passed (22)
Tests       199 passed (199)
Exit code: 0

Command: npm.cmd run build --workspace @harness/server
Server bundle: success
Client bundle: success
Exit code: 0

Command: git diff --check
Exit code: 0
```

## API Shape

- `GET /api/config/providers` → `200 { providers: ProviderSummary[] }`; locked store → `423 CREDENTIAL_STORE_LOCKED`.
- `POST /api/config/providers` with `{ id, name, baseUrl, model, apiKey, masterPassword? }` → `201 { provider: ProviderSummary }`.
- `DELETE /api/config/providers/:id` → `200`; missing provider → `404 PROVIDER_NOT_FOUND`.
- `ProviderSummary` is `{ id, name, baseUrl, model, hasApiKey: true }`; it never contains `apiKey`.
- Existing `/api/config/status`, `/key`, `/unlock`, `/lock`, `/guide`, and DeepSeek environment-key behavior are unchanged.

## Security Decisions

- Provider records use distinct `harness/provider/<id>` entries inside the existing AES-256-GCM `CredentialStore` envelope. Both fake DeepSeek and provider sentinel values were proven absent from the credential file.
- Listing uses one bulk encrypted-envelope snapshot instead of rereading and reparsing the file once per provider.
- Provider IDs are lowercase, bounded, and restricted to `[a-z0-9._-]`. Names/models/keys are trimmed, bounded, non-empty, and reject control characters.
- Base URLs must parse as HTTP(S), have a hostname, and contain no embedded credentials, query, or fragment. This slice never fetches the configured URL, so it introduces no SSRF-capable execution behavior.
- Server-stored providers remain local-mode only under the existing runtime-policy guard. No login/auth was added; the local trust boundary is localhost access plus the operating-system user account, as stated in the ConfigPage.
- The browser clears the provider key field after both successful and failed create requests and displays server-returned metadata only.

## Files

- `packages/server/src/provider-configuration.ts`: provider validation, encrypted record naming, summaries, list/add/delete operations.
- `packages/server/src/routes/config.ts`: local provider CRUD routes behind the existing policy boundary.
- `packages/server/client/src/components/ProviderConfiguration.tsx`: small add/list/delete UI.
- `packages/server/client/src/components/ConfigPage.tsx`: mounts provider configuration and documents local trust.
- `packages/server/test/routes/provider-config.test.ts`: encryption, non-disclosure, compatibility, CRUD, and validation integration tests.
- `packages/server/test/routes/config-policy.test.ts`: public-mode provider-route denial.
- `packages/server/test/client/provider-config.test.tsx`: real component add/list/delete and key-clearing coverage.
- `packages/server/test/credential-store.test.ts`: bulk prefix snapshot coverage.

## Concerns and Boundaries

- Provider configuration is not yet consumed by agent execution. Adding adapters or network connectivity is deliberately outside this slice and needs a separate SSRF/egress design.
- Provider updates are intentionally not supported; delete and recreate avoids an unrequested mutation contract.
- Provider lists are local encrypted-file configuration and expected to stay small; no pagination is included.
- `artifacts/` and `REFLECTION.md` were not modified.
