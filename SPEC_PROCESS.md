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

### Verification Info

| Field | Value |
|-------|-------|
| **Agent** | ChatGPT |
| **Date** | 2026-08-03 |
| **Selected task** | Task 6 (LLMAdapter interface) |
| **Session** | Fresh conversation, no prior context or memory |
| **Input** | SPEC.md + PLAN.md only |

### Task 6 Attempt

The agent was asked to implement Task 6 (LLMAdapter interface) using only the SPEC and PLAN documents. It was instructed to stop at any point of uncertainty rather than guess.

**Where the agent paused:**

1. **Type dependency question**: "Task 6 depends on Task 2 (types.ts). Do you expect each task to strictly depend on prior tasks, or should each task be independently runnable?"

2. **Test approach question**: "Should interface tests use `tsc --noEmit` + Vitest, or just Vitest with `import type`?"

3. **Import style question**: "Should all type imports use `import type` syntax?"

### SPEC/PLAN Defects Exposed

Three ambiguities were identified that the original author (Claude Code) and the human had not noticed — they were shared tacit knowledge between the primary developer agent and the spec writer:

| # | Defect | Location | Severity | Resolution |
|---|--------|----------|----------|------------|
| 1 | **AgentContext lifecycle undefined** | SPEC §3.1 | Medium | Added: "每轮循环重新创建", messages "累积增长", feedbackState 由 AgentLoop 维护 |
| 2 | **AgentResponse lacks debug fields** | types.ts, PLAN Task 2 | Low | Added optional fields: `rawContent`, `responseId`, `model`, `latencyMs`, `usage` |
| 3 | **Message→OpenAI mapping missing** | SPEC §3.1 | Medium | Added explicit mapping table for system/user/assistant/tool roles |

### Misinterpretations

The agent's understanding of the architecture was consistent with the SPEC. No significant misinterpretations occurred. The agent correctly identified that:

- The harness is a "bare orchestrator" with injected interfaces
- The LLMAdapter is the single point of LLM contact
- The interface is compile-time only, with no runtime behavior to test

### Revisions Made

Commit `be10126`:
- `packages/core/src/types.ts`: AgentResponse gained 5 optional fields
- `SPEC.md`: Added context lifecycle paragraph (§3.1) and Message→OpenAI mapping (§3.1)
- `PLAN.md`: Updated AgentResponse definition to match types.ts

### Assessment

**SPEC quality: Good.** The agent was able to understand the architecture, identify the correct files, and write correct implementation code from the documents alone. The three defects found were real but minor — none required architectural changes. The SPEC was sufficiently precise for a new agent to begin implementation without major confusion.