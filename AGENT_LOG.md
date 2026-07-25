# Agent Log

## 2026-07-25 — Project Setup (Phase 1)
- **Tasks:** 1-5
- **Skills:** subagent-driven-development
- **Output:** Monorepo, types, CI, Vitest config
- **Key decisions:** npm workspaces, TypeScript strict mode, Vitest over Jest, GitHub Actions CI
- **Files created:** root package.json, tsconfig.base.json, 3 package.json files (core/server/cli), .github/workflows/ci.yml, packages/core/src/types.ts
- **Status:** 5/5 tasks complete

## 2026-07-25 — LLM Layer (Phase 2)
- **Tasks:** 6-9
- **Skills:** subagent-driven-development
- **Output:** LLMAdapter, MockLLMAdapter, DeepSeekAdapter, ResponseParser
- **Tests:** 50 tests
- **Key decisions:** MockLLMAdapter with FIFO response queue for deterministic testing, DeepSeek via OpenAI-compatible API, response parsing with completion detection
- **Files created:** adapter.ts, mock.ts, deepseek.ts, response-parser.ts + corresponding test files
- **Status:** 4/4 tasks complete

## 2026-07-25 — Tool System (Phase 3)
- **Tasks:** 10-17
- **Skills:** subagent-driven-development
- **Output:** ToolRegistry + 7 tools (read_file, write_file, execute_shell, run_tests, search_code, git_diff, git_commit)
- **Tests:** 117 tests
- **Key decisions:** Risk level system (safe/moderate/dangerous), path traversal protection, .git directory protection, 30s shell timeout, npm test as default test command
- **Files created:** tool.ts, read-file.ts, write-file.ts, execute-shell.ts, run-tests.ts, search-code.ts, git-diff.ts, git-commit.ts + corresponding test files
- **Status:** 8/8 tasks complete

## 2026-07-25 — Governance (Phase 4)
- **Tasks:** 18-22
- **Skills:** subagent-driven-development
- **Output:** Guardrail, HITLManager, GovernanceService, guardrail demo
- **Tests:** 157 tests
- **Key decisions:** Two-level safety (tool risk + command patterns), HITL state machine with 5 states, defense-in-depth approach
- **Files created:** guardrail.ts, hitl.ts, index.ts (governance), guardrail-demo.test.ts + corresponding test files
- **Status:** 5/5 tasks complete

## 2026-07-25 — Feedback Loop (Phase 5) (Key Contribution)
- **Tasks:** 23-32
- **Skills:** subagent-driven-development
- **Output:** TestRunner, ResultParser, FailureClassifier, FixSuggestionBuilder, FeedbackLoop, parser plugins, 3 demos
- **Tests:** 222 tests
- **Key decisions:** Harness provides context, LLM generates fixes (separation of concerns), plugin-based ResultParser for Jest/Vitest, priority-based failure classification (syntax=high, assertion=medium, timeout=low)
- **Files created:** test-runner.ts, result-parser.ts, failure-classifier.ts, fix-suggestion.ts, feedback-loop.ts, index.ts (feedback), feedback-demo.test.ts, deep-demo.test.ts, result-parser-plugins.test.ts + corresponding test files
- **Status:** 10/10 tasks complete

## 2026-07-25 — Memory + Config (Phase 6)
- **Tasks:** 33-37
- **Skills:** subagent-driven-development
- **Output:** MemoryStore, ContextBuilder, ConfigLoader, StopCondition
- **Tests:** 254 tests
- **Key decisions:** SQLite via sql.js for memory (WASM, no native compilation), YAML for config, per-project memory isolation, default config with user overrides
- **Files created:** memory-store.ts, context-builder.ts, config-loader.ts, stop-condition.ts + corresponding test files
- **Status:** 5/5 tasks complete

## 2026-07-25 — Agent Loop (Phase 7)
- **Tasks:** 38-43
- **Skills:** subagent-driven-development
- **Output:** AgentLoop, SessionStore, build config
- **Tests:** 278 tests
- **Key decisions:** Bare orchestrator pattern (no logic in loop, all via injected interfaces), JSON file session storage, tsup for ESM builds
- **Files created:** agent-loop.ts, session-store.ts, updated index.ts (unified exports), build configs
- **Status:** 6/6 tasks complete

## 2026-07-25 — Server + Frontend (Phase 8)
- **Tasks:** 44-53
- **Skills:** subagent-driven-development
- **Output:** Express server, SSE, React frontend (ChatPanel, ToolCallCard, GuardrailDialog, FeedbackTimeline, SessionHistory)
- **Tests:** 278 core tests + frontend builds
- **Key decisions:** SSE over WebSocket for simplicity, Vite dev server with API proxy, React 19, simple state-based routing (no React Router)
- **Files created:** server.ts, routes/agent.ts, routes/session.ts, routes/config.ts, sse/sse-manager.ts, client/index.html, client/src/main.tsx, client/src/App.tsx, client/vite.config.ts, ChatPanel.tsx, ToolCallCard.tsx, GuardrailDialog.tsx, FeedbackTimeline.tsx, SessionHistory.tsx, useSSE.ts
- **Status:** 10/10 tasks complete

## 2026-07-25 — CLI + Docs (Phase 9)
- **Tasks:** 54-62
- **Skills:** subagent-driven-development
- **Output:** CLI, README, SPEC_PROCESS, AGENT_LOG, render.yaml
- **Key decisions:** CLI as thin server launcher, Render free tier for deployment, comprehensive documentation
- **Files created:** cli.ts, render.yaml, README.md, SPEC_PROCESS.md, AGENT_LOG.md
- **Status:** 9/9 tasks complete