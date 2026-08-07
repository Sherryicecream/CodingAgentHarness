# Agent 日志

> 按时间顺序记录关键节点，每条包含：时间戳与 task 编号、触发的 Superpowers 技能、关键 prompt / context 配置、subagent 输出的关键片段或 commit hash、人工干预（修改了什么、为什么）、学到的教训。

---

## 2026-07-25 — 项目搭建（Phase 1）
- **Tasks:** 1-5
- **Skills:** subagent-driven-development
- **产出:** Monorepo 骨架、类型定义、CI 配置、Vitest 测试框架
- **关键决策:** npm workspaces 管理 monorepo、TypeScript 严格模式、选用 Vitest 而非 Jest、GitHub Actions CI
- **创建的文件:** 根 package.json、tsconfig.base.json、3 个包级 package.json（core/server/cli）、.github/workflows/ci.yml、packages/core/src/types.ts
- **状态:** 5/5 tasks 完成

## 2026-07-25 — LLM 抽象层（Phase 2）
- **Tasks:** 6-9
- **Skills:** subagent-driven-development
- **产出:** LLMAdapter、MockLLMAdapter、DeepSeekAdapter、ResponseParser
- **测试数:** 50 个
- **关键决策:** MockLLMAdapter 使用 FIFO 响应队列支持确定性测试、DeepSeek 通过 OpenAI 兼容 API 接入、响应解析带完成判定
- **创建的文件:** adapter.ts、mock.ts、deepseek.ts、response-parser.ts + 对应测试文件
- **状态:** 4/4 tasks 完成

## 2026-07-25 — 工具系统（Phase 3）
- **Tasks:** 10-17
- **Skills:** subagent-driven-development
- **产出:** ToolRegistry + 7 个工具（read_file、write_file、execute_shell、run_tests、search_code、git_diff、git_commit）
- **测试数:** 117 个
- **关键决策:** 风险等级系统（safe/moderate/dangerous）、路径穿越防护、.git 目录保护、30 秒 Shell 超时、默认测试命令为 npm test
- **创建的文件:** tool.ts、read-file.ts、write-file.ts、execute-shell.ts、run-tests.ts、search-code.ts、git-diff.ts、git-commit.ts + 对应测试文件
- **状态:** 8/8 tasks 完成

## 2026-07-25 — 治理系统（Phase 4）
- **Tasks:** 18-22
- **Skills:** subagent-driven-development
- **产出:** Guardrail、HITLManager、GovernanceService、护栏演示
- **测试数:** 157 个
- **关键决策:** 双层安全模型（工具风险等级 + 命令模式匹配）、HITL 状态机（5 个状态）、纵深防御设计
- **创建的文件:** guardrail.ts、hitl.ts、index.ts（governance）、guardrail-demo.test.ts + 对应测试文件
- **状态:** 5/5 tasks 完成

## 2026-07-25 — 反馈闭环 ★ 核心贡献（Phase 5）
- **Tasks:** 23-32
- **Skills:** subagent-driven-development
- **产出:** TestRunner、ResultParser、FailureClassifier、FixSuggestionBuilder、FeedbackLoop、解析器插件、3 个演示用例
- **测试数:** 222 个
- **关键决策:** Harness 提供上下文，LLM 生成修复（关注点分离）、基于插件的 ResultParser 支持 Jest/Vitest、基于优先级的失败分类（syntax=高、assertion=中、timeout=低）
- **创建的文件:** test-runner.ts、result-parser.ts、failure-classifier.ts、fix-suggestion.ts、feedback-loop.ts、index.ts（feedback）、feedback-demo.test.ts、deep-demo.test.ts、result-parser-plugins.test.ts + 对应测试文件
- **状态:** 10/10 tasks 完成

## 2026-07-25 — 记忆 + 配置（Phase 6）
- **Tasks:** 33-37
- **Skills:** subagent-driven-development
- **产出:** MemoryStore、ContextBuilder、ConfigLoader、StopCondition
- **测试数:** 254 个
- **关键决策:** 使用 sql.js（WASM 版 SQLite）避免原生编译问题、YAML 格式配置、按项目隔离记忆、默认值 + 用户覆盖
- **创建的文件:** memory-store.ts、context-builder.ts、config-loader.ts、stop-condition.ts + 对应测试文件
- **状态:** 5/5 tasks 完成

## 2026-07-25 — Agent 主循环（Phase 7）
- **Tasks:** 38-43
- **Skills:** subagent-driven-development
- **产出:** AgentLoop、SessionStore、构建配置
- **测试数:** 278 个
- **关键决策:** 裸编排器模式（循环中不含业务逻辑，全部通过接口注入）、JSON 文件会话存储、tsup 构建 ESM 产物
- **创建的文件:** agent-loop.ts、session-store.ts、更新 index.ts（统一导出）、构建配置
- **状态:** 6/6 tasks 完成

## 2026-07-25 — 服务端 + 前端（Phase 8）
- **Tasks:** 44-53
- **Skills:** subagent-driven-development
- **产出:** Express 服务器、SSE 推送、React 前端（ChatPanel、ToolCallCard、GuardrailDialog、FeedbackTimeline、SessionHistory）
- **测试数:** 278 个核心测试 + 前端构建
- **关键决策:** 选用 SSE 而非 WebSocket（更简单）、Vite 开发服务器带 API 代理、React 19、基于状态的简单路由（无 React Router）
- **创建的文件:** server.ts、routes/agent.ts、routes/session.ts、routes/config.ts、sse/sse-manager.ts、client/index.html、client/src/main.tsx、client/src/App.tsx、client/vite.config.ts、ChatPanel.tsx、ToolCallCard.tsx、GuardrailDialog.tsx、FeedbackTimeline.tsx、SessionHistory.tsx、useSSE.ts
- **状态:** 10/10 tasks 完成

## 2026-08-03 — 收尾阶段（冷启动验证 + 凭据管理 + 分发 + 文档修补）
- **Tasks:** 冷启动验证补做，Phase 1 重写（凭据管理），Phase 2（Docker/npm 发布）
- **Skills:** 无（人工审查与补做）
- **产出:** Codex 完成 Tasks 6+7 冷启动验证，发现 8 个缺陷 | 加密文件凭据存储 | ConfigPage 前端配置页 | Dockerfile | npm publish 配置
- **关键决策:**
  - 冷启动验证从 ChatGPT 对话改为 Codex 真实实现（30 分钟），发现 8 个缺陷 vs 初轮 3 个
  - 凭据存储从 keytar 改为 AES-256-GCM 加密文件（跨平台，无需原生编译）
  - 部署目标从 Render 改为阿里云 ECS（Docker 容器化）
  - 前端新增 Config 标签页替代原有 placeholder
- **修复的缺陷:** SPEC.md Vercel→Render 矛盾修复 | PLAN.md Task 2/6 LLMAdapter 重复定义修复 | PLAN.md 依赖声明提前到 Phase 1 | 冷启动 prompt 修正
- **创建的文件:** credential-store.ts、ConfigPage.tsx、Dockerfile、.dockerignore、cold-start-prompt.md、cold-start-recording-template.md
- **修改的文件:** config.ts、agent.ts、server.ts、App.tsx、styles.css、SPEC.md、PLAN.md、SPEC_PROCESS.md、README.md、packages/*/package.json
- **状态:** 完成 ✅（阿里云 ECS 已部署，公网 IP 47.98.97.255:3000 可访问；REFLECTION.md 已完成）
- **后续修复:** `f6e5f3f` 更新部署公网 IP | `1be4bab` UI 中文化 + 引导增强 | `1162ace` 完成反思报告 | `33352ba` 修复任务完成后输入框可用状态

## 2026-08-03 — UI 中文化 + 引导增强（收尾阶段）
- **Tasks:** UI 提升、中文化、增加引导
- **Skills:** 人工审查
- **产出:** 欢迎引导卡片、全界面中文化、错误消息中文化
- **关键决策:** 遵循 Open Design 规范（DESIGN.md）设计引导卡片；保持与现有设计令牌一致（颜色、间距、圆角、字体）
- **修改的文件:**
  - `index.html` — 页面标题改为 "Harness - 编码智能体工作台"，语言设为 zh-CN
  - `useSSE.ts` — 错误消息中文化
  - `ChatPanel.tsx` — 新增完整欢迎引导卡片（产品介绍、工作原理流程、核心功能、文件位置说明）
  - `styles.css` — 新增约 120 行引导卡片样式
  - `agent.ts` — 4 条错误消息中文化
  - `config.ts` — 5 条消息 + 引导文案中文化
  - `server.ts` — 启动日志中文化
  - `session.ts` — 未找到会话消息中文化
- **状态:** 完成