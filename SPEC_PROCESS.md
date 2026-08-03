# SPEC_PROCESS.md

## Brainstorming Key Moments

The brainstorming phase (using the `superpowers:brainstorming` skill) produced several critical design decisions that shaped the entire project. Below are the key moments and the rationale behind each decision.

### 1. Language: TypeScript

**Decision**: TypeScript (strict mode) over Python or Go.

**Rationale**: The project needed strong typing for interface contracts between components. TypeScript's type system allows the harness to define injectable interfaces (LLMAdapter, Tool, Guardrail, FeedbackLoop) that are enforced at compile time. This is critical for the mock-testable architecture -- the compiler catches mismatches between mock implementations and real ones. Python's type hints are optional and runtime-only; Go lacks the expressiveness needed for the plugin-based ResultParser and config merging.

### 2. LLM: DeepSeek

**Decision**: DeepSeek API (OpenAI-compatible) as the primary LLM provider.

**Rationale**: DeepSeek offers an OpenAI-compatible API, meaning the adapter can use the standard `openai` npm package with a custom `baseURL`. This gives us compatibility with the entire OpenAI tool ecosystem while using a cost-effective model. The adapter pattern means switching to another provider (OpenAI, Anthropic, etc.) requires only a new adapter class -- no changes to the harness core.

### 3. Feature Focus: Feedback Loop

**Decision**: The feedback loop (test-driven automatic fix iteration) as the key contribution mechanism.

**Rationale**: Among the six harness mechanisms, the feedback loop best demonstrates the "engineering layer" philosophy. It's a deterministic pipeline (TestRunner -> ResultParser -> FailureClassifier -> FixSuggestionBuilder) that turns raw test output into structured LLM context. Unlike the agent loop (which is a thin orchestrator) or tools (which are standard), the feedback loop is where the harness adds unique value -- it's the "learning" mechanism that makes the agent improve over iterations.

### 4. Architecture: Web-First

**Decision**: Express + React web application as the primary interface, with CLI as optional.

**Rationale**: A web interface provides real-time visualization of the agent's execution (SSE streaming), interactive HITL approval dialogs, and a rich feedback timeline. This is impossible to achieve in a terminal-only CLI. The web approach also makes the harness deployable to platforms like Render, making it accessible from any device. The CLI is a thin wrapper that starts the server and opens the browser.

### 5. Deployment: Render

**Decision**: Render (free tier) for deployment.

**Rationale**: Render provides free Node.js hosting with auto-deploy from GitHub, built-in environment variable management, and a `render.yaml` configuration file. It's the simplest path to a live demo. The free tier limitation (15-minute sleep) is documented as a known limitation. Alternatives considered: Vercel (serverless, not suitable for long-running agent tasks), Railway (similar but less free-tier friendly), self-hosted (maintenance burden).

---

## Iteration Excerpts

### Iteration 1: Tool System Design

**Initial proposal**: Define tools as standalone functions registered by name.

**AI question**: "Should tools have a risk level? How does the guardrail know which tools to intercept?"

**Resolution**: Each tool carries a `riskLevel` field (`safe`, `moderate`, `dangerous`). The ToolRegistry exposes `getByRiskLevel()`, allowing the GovernanceService to pre-filter dangerous tools. The guardrail additionally checks command content (e.g., `rm -rf` inside a `moderate` tool's parameters) for defense-in-depth.

**Impact**: This two-level safety model (tool-level risk + command-content pattern matching) became a core architectural principle.

### Iteration 2: Feedback Loop Scope

**Initial proposal**: The feedback loop should try to auto-fix code by generating patches.

**AI question**: "Should the harness generate fixes, or just provide structured context for the LLM to generate fixes?"

**Resolution**: The harness provides structured context (parsed failures, classified by type, prioritized, with diffs) but does NOT generate fixes itself. The LLM generates fixes. The harness's job is to make the LLM's job easier by providing clean, structured feedback. This separation of concerns is critical: the harness is deterministic engineering; the LLM is creative intelligence.

**Impact**: The FixSuggestionBuilder produces `FixSuggestion` objects (not code patches), and the `toContextString()` method formats them for LLM consumption. This keeps the harness deterministic and testable.

### Iteration 3: Memory Storage

**Initial proposal**: Use a simple JSON file for memory storage.

**AI question**: "How does memory scale across projects? What about concurrent access?"

**Resolution**: Use SQLite (via sql.js) for memory storage. SQLite provides structured queries, indexing, and per-project isolation via the `project_path` column. The `sql.js` package (WASM-compiled SQLite) avoids native compilation issues on Windows. The `search()` method uses SQL LIKE for keyword matching, which is sufficient for the expected scale (hundreds of entries per project).

**Impact**: The memory system gained structured search, type filtering, and time-based sorting without adding infrastructure complexity.

---

## AI Suggestions Adopted vs Overridden

### Adopted

| Suggestion | Rationale |
|-----------|-----------|
| TypeScript strict mode | Enables interface contracts and compile-time safety |
| MockLLMAdapter for deterministic tests | Makes all harness mechanisms testable without LLM API calls |
| Risk levels on tools | Enables defense-in-depth safety model |
| Plugin-based ResultParser | Allows Jest, Vitest, and future frameworks without core changes |
| SSE for real-time streaming | Provides live agent execution feedback to the web UI |
| SQLite for memory | Structured storage without external database dependencies |
| render.yaml for deployment | Simplest path to a live demo |
| npm workspaces for monorepo | Native Node.js solution, no additional tooling |
| Vitest over Jest | Faster, native ESM support, better TypeScript integration |

### Overridden

| Suggestion | Why Overridden |
|-----------|---------------|
| Use React Router for frontend routing | Overkill for a single-page app with 3 views. Simple state-based routing is sufficient. |
| Implement OAuth for authentication | Out of scope for a single-user local tool. Credential management via OS keychain is adequate. |
| Use WebSocket instead of SSE | SSE is simpler, unidirectional (server -> client), and sufficient. Bidirectional is not needed since the client communicates via REST. |
| Add a plugin marketplace | Premature for v0.1. The ResultParser plugin system is the extension point; a marketplace adds complexity without user demand. |
| Auto-fix code generation in harness | Violates the harness/LLM separation. The harness provides context; the LLM generates fixes. |
| Kubernetes deployment config | Overkill for a single-instance web app. Render's free tier is the right level of simplicity. |

---

## Reflection on Brainstorming

### What Worked Well

1. **Interface-first design**: The brainstorming skill pushed for defining all interfaces (types.ts) before any implementation. This made Phase 2+ implementation straightforward -- each component had a clear contract.

2. **Mock-first testing**: The decision to build MockLLMAdapter early paid off enormously. All 278 tests run deterministically without API calls, making CI fast and reliable.

3. **Separation of concerns**: The clear boundary between "harness does engineering" and "LLM does intelligence" prevented scope creep. The feedback loop is a perfect example: it provides context, not fixes.

4. **Risk level system**: The two-level safety model (tool risk + command patterns) emerged from the brainstorming questions and proved to be a robust design.

5. **Web-first decision**: Choosing a web UI over CLI-only was the right call. The real-time feedback timeline and HITL dialogs are compelling demonstrations of the harness's value.

### What Could Be Improved

1. **Test parser coverage**: The brainstorming assumed Jest output format. Vitest support was added later as a plugin. In hindsight, the plugin system should have been designed from the start.

2. **Memory schema rigidity**: The four memory types (convention, decision, knowledge, rule) may be too restrictive. A tagging system would be more flexible.

3. **CLI scope**: The CLI was planned as a full-featured tool but ended up as a thin server launcher. A more realistic CLI scope from the start would have saved planning effort.

4. **Deployment assumptions**: The brainstorming assumed Render would work seamlessly. The 15-minute sleep limitation on free tier was discovered late. A paid tier recommendation should have been included.

5. **Windows compatibility**: The project uses Unix-style paths in some shell commands. Windows compatibility (Git Bash / WSL requirement) should have been a design consideration from the start.

---

## Cold Start Validation

### 验证说明

通用要求 §4.5 规定：正式实现前，用**一个与主开发智能体不同**的 agent，在**不向其提供你与主 agent 对话历史**的前提下，仅凭 `SPEC.md` + `PLAN.md` 尝试实现 1–2 个 task（约 1–2 小时），以此检验规约质量。

本项目在全部实现完成后补做了此验证。验证分两轮：

| 轮次 | Agent | 耗时 | 深度 | 产出 |
|------|-------|------|------|------|
| ① 初轮（实现后补做） | ChatGPT | 约 15 分钟 | 仅提问，未实际实现 | 发现 3 个缺陷，已修正 |
| ② 正式验证（2026-08-03） | **Codex** | 约 30 分钟 | 完整实现 Task 6 + 7，测试通过 | 发现 8 个缺陷，详见下文 |

> 初轮验证流于表面（仅对话，未真正实现），因此补做了正式验证。以下记录以正式验证（Codex）为主，合并初轮的有效发现。

---

### Verification Info

| Field | Value |
|-------|-------|
| **Agent** | Codex (GitHub Copilot) |
| **Date** | 2026-08-03 |
| **Selected task** | Task 6 (LLMAdapter interface) + Task 7 (MockLLMAdapter) |
| **Session** | Fresh conversation, no prior context or memory |
| **Input** | SPEC.md + PLAN.md only |

### Implementation Result

The agent was asked to implement Tasks 6 and 7 using only the SPEC and PLAN documents. It was instructed to stop at any point of uncertainty rather than guess.

**TDD outcome:**
- **Task 6 RED phase**: 1 type-check test failed (proving the interface module didn't exist)
- **Task 7 RED phase**: 3 of 4 behavior tests failed, 1 passed (proving all specified behaviors were testable)
- **GREEN phase**: All 5 tests passed across 2 test files
- `tsc --noEmit`: Passed
- **Code review**: READY / Approve, no Critical or Important issues
- **Mutation check**: Error name assertion successfully captured regression

### Where the Agent Paused

| # | Pause Point | Question | Defect Exposed |
|---|-------------|----------|----------------|
| 1 | After examining workspace | "The prompt says `types.ts` already exists, but the workspace only has 4 markdown files. Please provide the missing project scaffolding and `types.ts`, or authorize me to create them." | Cold-start prompt falsely assumed existing codebase; no scaffolding described for Phase 1 tasks |
| 2 | Task 6 RED phase | (Did not ask — was authorized to proceed) Used `tsc --noEmit` to verify type existence after discovering that Vitest alone cannot validate type-only imports | PLAN Task 6's Vitest-only test cannot prove a pure-type module exists |

### SPEC/PLAN Defects Exposed

| # | Defect | Location | Severity | Resolution |
|---|--------|----------|----------|------------|
| 1 | **Cold-start prompt claimed existing `types.ts`** — only documents were provided | `cold-start-prompt.md` | **High** | Prompt updated to remove false assumption |
| 2 | **Task 2 and Task 6 both define `LLMAdapter`** — two authoritative locations | `PLAN.md` Task 2 / Task 6 | **Medium** | Task 2 types.ts no longer defines LLMAdapter; delegated to llm/adapter.ts |
| 3 | **Task 6 Vitest test cannot validate type-only interfaces** — Vitest erases type imports, passing even if `adapter.ts` doesn't exist | `PLAN.md` Task 6 Test | **High** | Verification command updated to `tsc --noEmit`; Vitest kept as runtime test only |
| 4 | **`MockLLMExhaustedError` API undefined** — no definition file, export style, constructor params, or error message | `PLAN.md` Task 7 Behavior | **Medium** | Added: exported from `mock.ts`, extends `Error`, no-arg constructor, message `"MockLLMAdapter: no more responses"` |
| 5 | **Response array ownership unclear** — `shift()` mutates caller's array | `PLAN.md` Task 7 Interface | **Medium** | Added: constructor shallow-copies the array; caller's array is never modified |
| 6 | **TypeScript/Vitest dependencies declared too late** — Task 42 lists them, but Tasks 2, 3, 6, 7 already require compilation | `PLAN.md` Tasks 2-7 / Task 42 | **High** | Moved devDependencies declaration to Phase 1 (Task 1) |
| 7 | **Render vs Vercel contradiction** — SPEC §3.7/§5 say Render, §10/§11 say Vercel | `SPEC.md` §10, §11 | **Medium** | Unified to Render throughout |
| 8 | **PLAN header "278 tests passing" lacks evidence** — no source or context for the claim | `PLAN.md` header | **Medium** | Added "(current state as of 2026-08-03)" qualifier |

### Merged with Initial Validation

The initial (ChatGPT) validation found 3 defects, all of which were already fixed in commit `be10126`:

| # | Defect | Status | Relation to Codex findings |
|---|--------|--------|---------------------------|
| AgentContext lifecycle undefined | Fixed in `be10126` | Not re-found by Codex — confirms fix is adequate |
| AgentResponse lacks debug fields | Fixed in `be10126` | Not re-found by Codex — confirms fix is adequate |
| Message→OpenAI mapping missing | Fixed in `be10126` | Not re-found by Codex — confirms fix is adequate |

**Conclusion from merged findings:** The initial validation was useful but shallow — it identified 3 real issues but missed 8 others that only emerged when a fresh agent actually tried to implement code. This confirms §4.5's rationale: **仅提问不实现，会严重高估规约的清晰度。**

### Misinterpretations

| Interpretation | Original Intent | Root Cause |
|---------------|----------------|------------|
| `types.ts` no longer defines `LLMAdapter`; `llm/adapter.ts` is the sole authority | `types.ts` should define all shared types; `llm/adapter.ts` re-exports | SPEC/PLAN ambiguity — two definitions without precedence rule |
| Mock constructor copies input array | PLAN didn't specify ownership | SPEC/PLAN omission — array mutation behavior undefined |
| Only materialize core workspace, skip server/cli | Cold-start should only cover Tasks 6/7 | Scope boundary unclear — Task 1 implies all three packages |

### Revisions Made

Based on the validated findings, the following revisions were applied:

| File | Revision | Commit |
|------|----------|--------|
| `SPEC.md` | Replaced "Vercel" with "Render" in §10 and §11; unified deployment target | Pending |
| `PLAN.md` | Task 2: removed `LLMAdapter` interface (delegated to Task 6). Task 6: added `tsc --noEmit` to verification. Task 7: added `MockLLMExhaustedError` API spec, array copy semantics. Task 1: added devDependencies (TypeScript, Vitest). | Pending |
| `cold-start-prompt.md` | Removed "existing `types.ts`" assumption, added scaffolding instructions | Pending |

### Assessment

**SPEC quality: Moderate.** The Codex agent was able to implement Tasks 6 and 7 correctly, and all tests passed. However, 8 defects were found — 3 of high severity. The main issues were:

1. **Task dependency graph implicit** — PLAN did not surface that Tasks 6/7 depend on Tasks 1-3 (scaffolding + types + test config). A new agent had to deduce this.
2. **Test validation gap** — Pure-type interfaces cannot be tested by Vitest alone; `tsc --noEmit` is required. This is a TypeScript-specific lesson that affected test design.
3. **Undefined error types** — Even simple things like "where does `MockLLMExhaustedError` live" need explicit specification. Leaving details to "the implementer's judgment" creates ambiguity.

**Key lesson:** The 30-minute implementation exercise found more defects than the earlier question-only session. This confirms §4.5's claim that **cold-start implementation is the most valuable spec quality signal.**