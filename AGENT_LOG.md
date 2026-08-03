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

## 2026-08-03 — 收尾阶段（冷启动验证 + 凭据管理 + 分发 + 文档修补）
- **Tasks:** 冷启动验证补做，Phase 1 重写（凭据管理），Phase 2（Docker/npm）
- **Skills:** 无（人工审查与补做）
- **Output:** Codex 完成 Tasks 6+7 冷启动验证，发现 8 个缺陷 | 加密文件凭据存储 | ConfigPage 前端配置页 | Dockerfile | npm publish 配置
- **Key decisions:**
  - 冷启动验证从 ChatGPT 对话改为 Codex 真实实现（30 分钟），发现 8 个缺陷 vs 初轮 3 个
  - 凭据存储从 keytar 改为 AES-256-GCM 加密文件（跨平台，无需原生编译）
  - 部署目标从 Render 改为阿里云 ECS（Docker 容器化）
  - 前端新增 Config 标签页替代原有 placeholder
- **Defects fixed:** SPEC.md Vercel→Render 矛盾修复 | PLAN.md Task 2/6 LLMAdapter 重复定义修复 | PLAN.md 依赖声明提前到 Phase 1 | 冷启动 prompt 修正
- **Files created:** credential-store.ts, ConfigPage.tsx, Dockerfile, .dockerignore, cold-start-prompt.md, cold-start-recording-template.md
- **Files modified:** config.ts, agent.ts, server.ts, App.tsx, styles.css, SPEC.md, PLAN.md, SPEC_PROCESS.md, README.md, packages/*/package.json
- **Status:** 待定（阿里云部署未完成，REFLECTION.md 未填写）