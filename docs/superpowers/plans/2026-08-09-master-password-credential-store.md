# Master-Password Credential Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace machine-derived credential encryption with a versioned, master-password-encrypted store while preserving local server credentials, transient BYOK, public denial, and safe UI lifecycle.

**Architecture:** A synchronous `CredentialStore` derives an in-memory AES-256-GCM key from a user-supplied master password using scrypt. The config router exposes explicit initialize/unlock/lock/update/delete operations and never returns a stored key; the React configuration page reflects empty/legacy/locked/unlocked states. Public runtime policy remains unchanged and rejects every credential operation.

**Tech Stack:** TypeScript, Node `crypto`/`fs`, Express, React 19, Vitest, Testing Library, npm workspaces.

## Global Constraints

- Use only Node.js standard-library crypto and filesystem APIs; add no native or runtime dependency.
- Version 2 uses scrypt `N=32768`, `r=8`, `p=1`, a 16-byte random salt, AES-256-GCM, and a fresh 12-byte IV per encrypted value.
- Never persist or return a master password or API Key in browser storage, logs, URLs, process arguments, Git, or plaintext configuration.
- Public mode remains demo-only and returns `CONFIG_DISABLED` for credential endpoints.
- Existing transient BYOK remains available in local mode and is not persisted.
- Legacy machine-derived files are detected but never automatically decrypted; the user must re-enter a Key and new master password.
- Local mode continues to support save, unlock, update, lock, clear, and test-key behavior.
- Every production change follows RED → GREEN; every task ends with a scoped commit and review.

---

## File Map

- `packages/server/src/credential-store.ts`: version 2 envelope, KDF, encryption, lock state, atomic file writes.
- `packages/server/test/credential-store.test.ts`: crypto/store lifecycle and malformed/legacy file tests.
- `packages/server/src/routes/config.ts`: status/unlock/initialize/update/lock/delete contract; remove key-value response.
- `packages/server/test/routes/config.test.ts`: local/public route and stable error-code tests.
- `packages/server/client/src/components/ConfigPage.tsx`: state-aware local credential UI.
- `packages/server/client/src/components/ChatPanel.tsx`: remove persistent server-key auto-fill.
- `packages/server/client/src/App.tsx`: preserve explicit runtime mode when rendering ConfigPage.
- `packages/server/test/client/public-modes.test.tsx`: UI lifecycle and no-key-return regressions.
- `README.md`: local credential lifecycle, migration, and known limitations.
- `SPEC.md`: credential design and threat model alignment.

### Task 1: Implement the versioned master-password store

**Files:**
- Modify: `packages/server/src/credential-store.ts`
- Test: `packages/server/test/credential-store.test.ts`

**Interfaces:**
- Produce `CredentialStoreState = 'empty' | 'legacy' | 'locked' | 'unlocked'`.
- Add `getState(): CredentialStoreState`, `unlock(masterPassword: string): boolean`, `lock(): void`, and `initialize(masterPassword: string): void` while preserving `hasKey`, `getKey`, `setKey`, `deleteKey`, and `listServices`.

- [ ] **Step 1: Write failing tests** for exact version-2 format, state transitions, correct/incorrect password, key round-trip, lock clearing, password length 12–128 validation, malformed envelope, legacy detection, atomic write, and delete.
- [ ] **Step 2: Run `npm.cmd test --workspace @harness/server -- credential-store.test.ts` and capture RED** because the new state methods/format do not exist.
- [ ] **Step 3: Implement minimal crypto/store behavior**: random salt/IV, scrypt parameters, verifier, AES-GCM entries, `0600` file/`0700` directory, same-directory temp write plus rename, legacy/version validation, and in-memory key zeroing on lock.
- [ ] **Step 4: Run the focused store tests and require GREEN** with all lifecycle and corruption cases passing.
- [ ] **Step 5: Run `git diff --check` and a scoped secret scan, self-review, and commit:**

```powershell
git add packages/server/src/credential-store.ts packages/server/test/credential-store.test.ts
git commit -m "security(server): encrypt credentials with a master password"
```

### Task 2: Expose safe local credential lifecycle APIs

**Files:**
- Modify: `packages/server/src/routes/config.ts`
- Modify: `packages/server/test/routes/config.test.ts`
- Modify: `packages/server/src/app.ts` only if dependency typing requires it.

**Interfaces:**
- `GET /api/config/status` returns `{ hasKey, source, state }` without secrets.
- `POST /api/config/unlock` accepts `{ masterPassword }`; success is 200, wrong password is 401 `{ error: 'INVALID_MASTER_PASSWORD' }`.
- `POST /api/config/key` accepts `{ key, masterPassword }` for empty/legacy, `{ key }` for unlocked, and returns 423 `{ error: 'CREDENTIAL_STORE_LOCKED' }` while locked.
- `POST /api/config/lock` locks memory.
- `DELETE /api/config/key` deletes only while unlocked.
- Remove `GET /api/config/key-value`; no stored key crosses the HTTP boundary.

- [ ] **Step 1: Add RED route tests** for empty initialization, unlock success/failure, locked update/delete, unlocked update/delete/lock, no key-value route, public `CONFIG_DISABLED`, and no secret in every response.
- [ ] **Step 2: Run `npm.cmd test --workspace @harness/server -- config.test.ts` and verify RED** on missing endpoints and old key-value behavior.
- [ ] **Step 3: Implement the minimal route changes** with stable status codes and no request-body logging; keep existing `test-key` and server-agent lookup using the in-memory unlocked store.
- [ ] **Step 4: Run focused route tests and require GREEN.**
- [ ] **Step 5: Run relevant existing BYOK/public route tests, diff check, and commit:**

```powershell
git add packages/server/src/routes/config.ts packages/server/test/routes/config.test.ts packages/server/src/app.ts
git commit -m "security(server): add explicit credential unlock lifecycle"
```

### Task 3: Update local configuration UI and remove persistent-key autofill

**Files:**
- Modify: `packages/server/client/src/components/ConfigPage.tsx`
- Modify: `packages/server/client/src/components/ChatPanel.tsx`
- Modify: `packages/server/client/src/App.tsx` if prop types need adjustment.
- Modify: `packages/server/test/client/public-modes.test.tsx`
- Add/Modify: `packages/server/test/client/config-page.test.tsx`

**Interfaces:**
- `ConfigPage` receives `mode: RuntimeMode` and performs no config fetches in public mode.
- Local UI states are `empty`, `legacy`, `locked`, and `unlocked`.
- The UI uses `POST /api/config/unlock`, `POST /api/config/key`, `POST /api/config/lock`, and `DELETE /api/config/key`; it never calls `/api/config/key-value`.

- [ ] **Step 1: Add RED UI tests** for each state, password inputs, unlock/lock/update/clear actions, no browser persistence, public static notice, and ChatPanel never auto-fetching a stored Key.
- [ ] **Step 2: Run `npm.cmd test --workspace @harness/server -- config-page.test.ts public-modes.test.tsx` and verify RED.**
- [ ] **Step 3: Implement state-aware UI**: mask both secrets, require a 12-character master password for initialization, clear values after actions/unmount, show only status/source, and remove the ChatPanel auto-fill effect.
- [ ] **Step 4: Run focused UI tests and require GREEN** with no unhandled errors.
- [ ] **Step 5: Run client build and commit:**

```powershell
npm.cmd run build --workspace @harness/server
git add packages/server/client/src/components/ConfigPage.tsx packages/server/client/src/components/ChatPanel.tsx packages/server/client/src/App.tsx packages/server/test/client/config-page.test.ts packages/server/test/client/public-modes.test.tsx
git commit -m "feat(web): add master-password credential controls"
```

### Task 4: Align SPEC/README and perform final verification

**Files:**
- Modify: `README.md`
- Modify: `SPEC.md`

**Interfaces:**
- Documentation must describe exactly the Task 1–3 API and state machine; no document may claim machine-derived encryption or persistent browser autofill.

- [ ] **Step 1: Add RED documentation checks** by scanning for the old machine-derived claims and missing master-password lifecycle terms.
- [ ] **Step 2: Update README and SPEC** with first save, restart/unlock, update, lock, clear, legacy re-entry, no recovery after forgotten password, public demo-only boundary, and `DEEPSEEK_API_KEY` environment-variable risk.
- [ ] **Step 3: Run focused credential/UI tests, then full `npm.cmd test`, server/core/CLI TypeScript checks, server build, `git diff --check`, and realistic-secret scans.**
- [ ] **Step 4: Inspect the complete diff for scope and update any tests whose contract still assumes public BYOK.**
- [ ] **Step 5: Commit documentation and verification evidence:**

```powershell
git add README.md SPEC.md
git commit -m "docs: document master-password credential lifecycle"
```

- [ ] **Step 6: Request final scoped review before merging into `master`.**

## Known limitations to document

- Forgetting the master password means the encrypted Key cannot be recovered; clear and re-enter it.
- JavaScript memory cannot guarantee immediate physical zeroization at process exit.
- Environment variables remain an optional deployment source and may be visible to the process; they are not the local interactive storage path.

## Self-review checklist

- Every design section has a task and a concrete verification command.
- No task relies on a function name not defined in this plan or the design.
- No step contains TBD/TODO/“implement later” or unspecified validation.
- Public mode, transient BYOK, local server credentials, and legacy migration do not contradict each other.
