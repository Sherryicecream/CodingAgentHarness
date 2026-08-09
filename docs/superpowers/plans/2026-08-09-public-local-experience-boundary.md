# Public and Local Experience Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public deployments expose only the deterministic demo while visibly explaining that BYOK and server credentials become available after running the complete project locally.

**Architecture:** `RuntimePolicy` remains the server-side source of truth and public sessions receive only the `demo` experience. The React client renders a fixed catalog of three experiences, deriving enabled state from server capabilities, while README and the public configuration notice describe the same public/local boundary.

**Tech Stack:** TypeScript, Express, React 19, Vitest, Testing Library, npm workspaces.

## Global Constraints

- Public mode must never accept, store, or use an API Key.
- Public mode must show all three experiences but enable only `demo`.
- Local mode must preserve `demo`, `byok`, and `server` behavior.
- Do not add a download button, domain, HTTPS tunnel, container registry, or dependency.
- The server must reject forged public `byok` and `server` requests independently of the UI.
- All production behavior changes follow RED → GREEN tests.

---

## File Map

- `packages/server/src/security/runtime-policy.ts`: authoritative public/local capability sets.
- `packages/server/test/security/runtime-policy.test.ts`: policy contract tests.
- `packages/server/test/routes/public-agent-routes.test.ts`: server rejection tests for forged modes.
- `packages/server/client/src/components/ChatPanel.tsx`: fixed three-option catalog, enabled state, and explanatory copy.
- `packages/server/client/src/components/ConfigPage.tsx`: public-mode local-run explanation; local credential UI remains unchanged.
- `packages/server/client/src/App.tsx`: passes runtime mode into `ConfigPage` so it does not infer public mode from a failed request.
- `packages/server/test/client/public-modes.test.tsx`: user-visible public/local behavior tests.
- `README.md`: public/local operation and credential boundary.

### Task 1: Make the public server policy demo-only

**Files:**
- Modify: `packages/server/test/security/runtime-policy.test.ts`
- Modify: `packages/server/test/routes/public-agent-routes.test.ts`
- Modify: `packages/server/src/security/runtime-policy.ts`

**Interfaces:**
- Consumes: `resolveRuntimePolicy(value?: string): RuntimePolicy`.
- Produces: `PUBLIC_RUNTIME_POLICY` with `allowByok: false`, `allowServerCredentials: false`, and `allowedExperiences: ['demo']`.

- [ ] **Step 1: Change the policy test to describe the desired public capability set**

```ts
expect(resolveRuntimePolicy('public')).toEqual({
  mode: 'public',
  allowServerCredentials: false,
  allowByok: false,
  allowProcessTools: false,
  allowHttpByok: false,
  allowedExperiences: ['demo'],
});
```

- [ ] **Step 2: Add route assertions for both forged real-API modes**

```ts
it.each(['byok', 'server'] as const)(
  'rejects forged public %s runs before constructing an agent',
  async (mode) => {
    const response = await request(app)
      .post('/api/agent/run')
      .send({ sessionId, task: 'do not run', mode, ...(mode === 'byok' ? { apiKey: 'fake-test-key' } : {}) });
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'EXPERIENCE_NOT_ALLOWED' });
    expect(agentRunFactory).not.toHaveBeenCalled();
  },
);
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
npm.cmd test --workspace @harness/server -- runtime-policy.test.ts public-agent-routes.test.ts
```

Expected: policy expectations fail because public currently allows BYOK; the `byok` forged-run assertion exposes the old permission.

- [ ] **Step 4: Apply the minimal policy implementation**

```ts
export const PUBLIC_RUNTIME_POLICY: RuntimePolicy = Object.freeze({
  mode: 'public',
  allowServerCredentials: false,
  allowByok: false,
  allowProcessTools: false,
  allowHttpByok: false,
  allowedExperiences: Object.freeze(['demo'] as const),
});
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the Step 3 command. Expected: all focused policy and route tests pass.

- [ ] **Step 6: Commit the server boundary**

```powershell
git add packages/server/src/security/runtime-policy.ts packages/server/test/security/runtime-policy.test.ts packages/server/test/routes/public-agent-routes.test.ts
git commit -m "security(server): restrict public sessions to demo"
```

### Task 2: Render three clearly scoped experiences in the WebUI

**Files:**
- Modify: `packages/server/test/client/public-modes.test.tsx`
- Modify: `packages/server/client/src/components/ChatPanel.tsx`
- Modify: `packages/server/client/src/components/ConfigPage.tsx`
- Modify: `packages/server/client/src/App.tsx`

**Interfaces:**
- Consumes: `RuntimeSession.mode`, `RuntimeSession.capabilities.allowedExperiences`, and `RuntimeSession.capabilities.allowServerCredentials`.
- Produces: `ConfigPageProps { mode: RuntimeMode }` and a fixed `EXPERIENCE_OPTIONS` catalog used by `ChatPanel`.

- [ ] **Step 1: Update the public fixture and add failing UI assertions**

```ts
const publicSession = (): SessionResponse => ({
  // unchanged fields
  capabilities: {
    allowedExperiences: ['demo'],
    allowByok: false,
    allowProcessTools: false,
    allowServerCredentials: false,
    allowHttpByok: false,
  },
});

it('shows local real-API choices as disabled explanations in public mode', async () => {
  await renderLoadedApp(publicSession());
  expect(screen.getByRole('radio', { name: /安全演示/ })).not.toBeDisabled();
  expect(screen.getByRole('radio', { name: /使用自己的 API Key/ })).toBeDisabled();
  expect(screen.getByRole('radio', { name: /本地服务器凭据/ })).toBeDisabled();
  expect(screen.getByText(/公网演示不接收 API Key/)).toBeTruthy();
  expect(screen.getByText(/下载完整项目并在 localhost 或 127\.0\.0\.1/)).toBeTruthy();
  expect(screen.queryByLabelText('DeepSeek API Key')).toBeNull();
});
```

- [ ] **Step 2: Add a failing configuration-page boundary test**

```ts
it('explains local credentials without calling config APIs in public mode', async () => {
  window.history.replaceState({}, '', '/config');
  const fetchSpy = installFetch(publicSession());
  render(<App />);
  expect(await screen.findByText(/公网演示无需配置 API Key/)).toBeTruthy();
  expect(screen.getByText(/HARNESS_MODE=local/)).toBeTruthy();
  expect(fetchSpy.mock.calls.some(([url]) => String(url).startsWith('/api/config/'))).toBe(false);
});
```

- [ ] **Step 3: Run the client test and verify RED**

Run:

```powershell
npm.cmd test --workspace @harness/server -- public-modes.test.tsx
```

Expected: the server option is absent in public mode, explanatory copy is absent, and `ConfigPage` still calls disabled config APIs.

- [ ] **Step 4: Implement the fixed experience catalog**

Add a catalog in `ChatPanel.tsx`:

```ts
const EXPERIENCE_OPTIONS: readonly RuntimeExperience[] = ['demo', 'byok', 'server'];
```

Render `EXPERIENCE_OPTIONS` rather than `allowedExperiences`. Set `disabled` whenever the option is not in `allowedExperiences`; retain the existing BYOK browser-security check for allowed local BYOK. Render explicit text for unavailable public options:

```tsx
{runtimeInfo.mode === 'public' && option === 'byok' && (
  <small>公网演示不接收 API Key；下载完整项目并在 localhost 或 127.0.0.1 上运行后可用。</small>
)}
{runtimeInfo.mode === 'public' && option === 'server' && (
  <small>仅本地可信模式可用；凭据由本机用户配置、更新和清除。</small>
)}
```

- [ ] **Step 5: Make public configuration rendering explicit**

Change `ConfigPage` to accept the runtime mode:

```ts
interface ConfigPageProps { mode: RuntimeMode }
export function ConfigPage({ mode }: ConfigPageProps) { /* ... */ }
```

If `mode === 'public'`, render a static explanation immediately and do not run config fetches. Pass `runtimeInfo.mode` from `App.tsx`. If `mode === 'local'`, preserve the existing credential UI and API calls.

- [ ] **Step 6: Run the client test and verify GREEN**

Run the Step 3 command. Expected: all public/local UI tests pass with no unhandled errors.

- [ ] **Step 7: Commit the UI boundary**

```powershell
git add packages/server/client/src/App.tsx packages/server/client/src/components/ChatPanel.tsx packages/server/client/src/components/ConfigPage.tsx packages/server/test/client/public-modes.test.tsx
git commit -m "feat(web): explain local real-API experiences"
```

### Task 3: Align README and verify the complete change

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the Task 1 public policy and Task 2 WebUI wording.
- Produces: one authoritative public/local capability table and exact Windows local startup commands.

- [ ] **Step 1: Replace outdated public BYOK claims**

Update the runtime table so `public` means deterministic demo only. Replace the “公开 BYOK” column with “本地自己的 Key” and state that the deployed HTTP WebUI does not accept API keys.

- [ ] **Step 2: Add exact local PowerShell instructions**

```powershell
Set-Location C:\CodingAgentHarness-master
npm.cmd ci
npm.cmd run build
Set-Location .\packages\server
$env:NODE_ENV = "development"
$env:HARNESS_MODE = "local"
$env:HOST = "127.0.0.1"
$env:PORT = "3000"
npm.cmd start
```

Document that the user opens `http://127.0.0.1:3000`, then chooses either “使用自己的 API Key” or “本地服务器凭据”. Do not include a real key or a key-shaped placeholder.

- [ ] **Step 3: Check documentation for contradictory claims**

Run:

```powershell
Select-String -Path README.md -Pattern '公开 BYOK|public.*BYOK|公网.*API Key|HARNESS_MODE'
```

Expected: no text claims that the hosted public deployment accepts an API Key; local setup is explicit.

- [ ] **Step 4: Run final verification**

```powershell
npm.cmd test --workspace @harness/server -- runtime-policy.test.ts public-agent-routes.test.ts public-modes.test.tsx
npm.cmd test --workspace @harness/server
npm.cmd run build --workspace @harness/server
git diff --check
```

Expected: focused and server tests pass, server build exits 0, and `git diff --check` exits 0. If a known unrelated flaky test fails, rerun it alone and record both outputs rather than claiming a clean suite.

- [ ] **Step 5: Scan the staged change for credentials**

```powershell
git diff --cached --check
git diff --cached | Select-String -Pattern 'sk-[A-Za-z0-9]{12,}|DEEPSEEK_API_KEY\s*=\s*[^<\s]+'
```

Expected: no realistic key or assigned secret value.

- [ ] **Step 6: Commit documentation**

```powershell
git add README.md
git commit -m "docs: distinguish hosted demo from local API use"
```

- [ ] **Step 7: Request scoped review before integration**

Review all commits after `a6225d0`, verify the worktree is clean, then merge the short-lived branch into `master` only after approval.
