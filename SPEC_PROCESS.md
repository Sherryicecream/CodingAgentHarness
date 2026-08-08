# SPEC_PROCESS.md

## Brainstorming 关键节点

Brainstorming 阶段（使用 `superpowers:brainstorming` 技能）产出了几个关键设计决策，塑造了整个项目的方向。以下是关键节点和各决策的 rationale。

### 1. 语言选择：TypeScript

**决策**：选择 TypeScript（严格模式）而非 Python 或 Go。

**理由**：项目需要强类型系统来保证组件之间的接口契约。TypeScript 的类型系统允许 Harness 定义可注入的接口（LLMAdapter、Tool、Guardrail、FeedbackLoop），并在编译时强制执行。这对可 Mock 测试的架构至关重要——编译器能捕获 Mock 实现与真实实现之间的不匹配。Python 的类型提示是可选的且仅在运行时生效；Go 缺乏插件化 ResultParser 和配置合并所需的表达能力。

### 2. LLM 选择：DeepSeek

**决策**：选择 DeepSeek API（OpenAI 兼容）作为主要 LLM 供应商。

**理由**：DeepSeek 提供 OpenAI 兼容的 API，适配器可以使用标准的 `openai` npm 包，只需配置自定义 `baseURL`。这使我们在使用高性价比模型的同时，与整个 OpenAI 工具生态兼容。适配器模式意味着切换到其他供应商（OpenAI、Anthropic 等）只需编写新的适配器类——无需修改 Harness 核心。

### 3. 重点维度：反馈闭环

**决策**：选择反馈闭环（测试驱动的自动修复迭代）作为核心贡献机制。

**理由**：在六个 Harness 机制中，反馈闭环最能体现"工程层"的理念。它是一个确定性的流水线（TestRunner → ResultParser → FailureClassifier → FixSuggestionBuilder），将原始测试输出转化为结构化 LLM 上下文。与 Agent 主循环（薄编排层）或工具系统（标准实现）不同，反馈闭环是 Harness 增加独特价值的地方——它是使 Agent 在迭代中不断改进的"学习"机制。

### 4. 架构：Web 优先

**决策**：选择 Express + React Web 应用作为主要界面，CLI 为可选补充。

**理由**：Web 界面提供了 Agent 执行过程的实时可视化（SSE 流式推送）、交互式 HITL 审批弹窗、以及丰富的反馈时间线——这在纯终端 CLI 中无法实现。Web 架构也使 Harness 可以部署到云端，从任何设备访问。CLI 是一个薄封装层，功能是启动服务器并打开浏览器。

### 5. 部署：阿里云 ECS

**决策**：选择阿里云 ECS（Docker 容器化）作为部署平台。

**理由**：阿里云 ECS 提供国内可访问的弹性计算服务，支持 Docker 容器化部署，按量付费。备选方案 Render（免费版）有 15 分钟无请求休眠的限制，唤醒需 30-50 秒，不适合需要持续可用的场景。其他考虑过的方案：Vercel（Serverless，不适合长时间运行的 Agent 任务）、Railway（类似但免费额度更少）、自托管（维护负担）。

---

## 迭代节选

### 迭代 1：工具系统设计

**初始方案**：将工具定义为按名称注册的独立函数。

**AI 追问**："工具是否应该有风险等级？护栏如何知道哪些工具需要拦截？"

**决策**：每个工具携带 `riskLevel` 字段（`safe`、`moderate`、`dangerous`）。ToolRegistry 暴露 `getByRiskLevel()` 方法，GovernanceService 可以按风险等级预过滤危险工具。护栏另外检查命令内容（如 `moderate` 工具参数中的 `rm -rf`），实现纵深防御。

**影响**：这个双层安全模型（工具级风险 + 命令内容模式匹配）成为了核心架构原则。

### 迭代 2：反馈闭环范围

**初始方案**：反馈闭环应尝试通过生成补丁来自动修复代码。

**AI 追问**："Harness 应该生成修复，还是只提供结构化上下文让 LLM 生成修复？"

**决策**：Harness 提供结构化上下文（解析的失败信息、按类型分类、按优先级排序、带 diff），但**不生成修复**。LLM 生成修复。Harness 的职责是提供干净、结构化的反馈，让 LLM 的工作更轻松。这个关注点分离至关重要：Harness 是确定性工程，LLM 是创造性智能。

**影响**：FixSuggestionBuilder 产出 `FixSuggestion` 对象（而非代码补丁），`toContextString()` 方法将其格式化为 LLM 可消费的文本。这保持了 Harness 的确定性和可测试性。

### 迭代 3：记忆存储

**初始方案**：使用简单的 JSON 文件存储记忆。

**AI 追问**："记忆如何跨项目扩展？并发访问如何处理？"

**决策**：使用 SQLite（通过 sql.js）存储记忆。SQLite 提供结构化查询、索引和通过 `project_path` 列实现的按项目隔离。`sql.js` 包（WASM 编译的 SQLite）避免了 Windows 上的原生编译问题。`search()` 方法使用 SQL LIKE 进行关键词匹配，对预期规模（每个项目数百条记录）足够。

**影响**：记忆系统获得了结构化搜索、类型过滤和基于时间的排序，无需增加基础设施复杂度。

---

## AI 建议采纳 vs 推翻

### 采纳的建议

| 建议 | 理由 |
|-----------|-----------|
| TypeScript 严格模式 | 实现接口契约和编译时安全 |
| MockLLMAdapter 用于确定性测试 | 使所有 Harness 机制无需 LLM API 调用即可测试 |
| 工具风险等级体系 | 实现纵深防御安全模型 |
| 基于插件的 ResultParser | 支持 Jest、Vitest 和未来框架，无需修改核心 |
| SSE 用于实时流式推送 | 为 Web UI 提供实时代理执行反馈 |
| SQLite 用于记忆存储 | 结构化存储，无需外部数据库依赖 |
| npm workspaces 管理 monorepo | 原生 Node.js 解决方案，无需额外工具 |
| 选用 Vitest 而非 Jest | 更快，原生 ESM 支持，更好的 TypeScript 集成 |

### 推翻的建议

| 建议 | 推翻理由 |
|-----------|---------------|
| 使用 React Router 做前端路由 | 对于只有 3 个视图的单页应用来说过度设计。简单的状态路由足够 |
| 实现 OAuth 认证 | 单用户本地工具的范围外。通过 OS 密钥链管理凭据即可 |
| 使用 WebSocket 而非 SSE | SSE 更简单，单向（服务器→客户端），足够使用。双向通信不需要，因为客户端通过 REST 通信 |
| 添加插件市场 | v0.1 版本为时过早。ResultParser 插件系统就是扩展点；市场增加复杂度而无用户需求 |
| 在 Harness 中自动生成代码修复 | 违反 Harness/LLM 关注点分离。Harness 提供上下文，LLM 生成修复 |
| Kubernetes 部署配置 | 单实例 Web 应用过度设计。阿里云 ECS 的 Docker 部署是适当复杂度 |

---

## Brainstorming 反思

### 做得好的方面

1. **接口优先设计**：Brainstorming 技能推动在实现前定义所有接口（types.ts）。这使得 Phase 2+ 的实现直截了当——每个组件都有清晰的合约。

2. **Mock 优先测试**：早期构建 MockLLMAdapter 的决策带来了巨大回报。所有 450+ 个测试无需 API 调用即可确定性运行，使 CI 快速可靠。

3. **关注点分离**：Harness 做工程、LLM 做智能的清晰边界防止了范围蔓延。反馈闭环是完美例子：它提供上下文，而非修复。

4. **风险等级体系**：双层安全模型（工具风险 + 命令模式）从 Brainstorming 的问题中浮现，并被证明是稳健的设计。

5. **Web 优先决策**：选择 Web UI 而非纯 CLI 是正确的决定。实时反馈时间线和 HITL 弹窗是 Harness 价值的令人信服的展示。

### 可以改进的方面

1. **测试解析器覆盖范围**：Brainstorming 假设了 Jest 输出格式。Vitest 支持后来作为插件添加。事后看来，插件系统应该从一开始就设计好。

2. **记忆模式过于刚性**：四种记忆类型（convention、decision、knowledge、rule）可能过于严格。标签系统会更灵活。

3. **CLI 范围**：CLI 原计划为全功能工具，但最终成为薄服务器启动器。从一开始就设定更现实的 CLI 范围可以节省规划工作。

4. **部署假设**：Brainstorming 假设 Render 能无缝工作。免费版的 15 分钟休眠限制发现得太晚。应该包含付费版建议。

5. **Windows 兼容性**：项目在某些 Shell 命令中使用 Unix 风格路径。Windows 兼容性（Git Bash / WSL 需求）本应从一开始就是设计考虑。

---

## 冷启动验证

### 验证说明

通用要求 §4.5 规定：正式实现前，用**一个与主开发智能体不同**的 agent，在**不向其提供你与主 agent 对话历史**的前提下，仅凭 `SPEC.md` + `PLAN.md` 尝试实现 1–2 个 task（约 1–2 小时），以此检验规约质量。

本项目在全部实现完成后补做了此验证。验证分两轮：

| 轮次 | Agent | 耗时 | 深度 | 产出 |
|------|-------|------|------|------|
| ① 初轮（实现后补做） | ChatGPT | 约 15 分钟 | 仅提问，未实际实现 | 发现 3 个缺陷，已修正 |
| ② 正式验证（2026-08-03） | **Codex** | 约 30 分钟 | 完整实现 Task 6 + 7，测试通过 | 发现 8 个缺陷，详见下文 |

> 初轮验证流于表面（仅对话，未真正实现），因此补做了正式验证。以下记录以正式验证（Codex）为主，合并初轮的有效发现。

---

### 验证信息

| 字段 | 值 |
|-------|-------|
| **Agent** | Codex（GitHub Copilot） |
| **日期** | 2026-08-03 |
| **选定任务** | Task 6（LLMAdapter 接口）+ Task 7（MockLLMAdapter） |
| **会话** | 全新会话，无先前上下文或记忆 |
| **输入** | 仅 SPEC.md + PLAN.md |

### 实现结果

Agent 被要求仅使用 SPEC 和 PLAN 文档实现 Tasks 6 和 7。它被指示在遇到不确定之处时暂停，而非自行猜测。

**TDD 结果：**
- **Task 6 RED 阶段**：1 个类型检查测试失败（证明接口模块尚不存在）
- **Task 7 RED 阶段**：4 个行为测试中 3 个失败，1 个通过（证明所有指定行为均可测试）
- **GREEN 阶段**：2 个测试文件共 5 个测试全部通过
- `tsc --noEmit`：通过
- **代码评审**：通过 / 批准，无严重或重要问题
- **变异测试**：错误名称断言成功捕获回归

### Agent 暂停点

| # | 暂停点 | 问题 | 暴露的缺陷 |
|---|-------------|----------|----------------|
| 1 | 检查工作区后 | "提示说 `types.ts` 已存在，但工作区只有 4 个 markdown 文件。请提供缺失的项目脚手架和 `types.ts`，或授权我创建它们。" | 冷启动 prompt 错误假设了已有代码库；未描述 Phase 1 任务的脚手架步骤 |
| 2 | Task 6 RED 阶段 | （未提问——被授权继续）使用 `tsc --noEmit` 验证类型存在，因为发现 Vitest 本身无法验证纯类型模块 | PLAN Task 6 仅用 Vitest 测试无法证明纯类型模块存在 |

### 暴露的 SPEC/PLAN 缺陷

| # | 缺陷 | 位置 | 严重程度 | 处理 |
|---|--------|----------|----------|------------|
| 1 | **冷启动 prompt 声称 `types.ts` 已存在**——实际上只提供了文档 | `cold-start-prompt.md` | **高** | Prompt 已更新，移除错误假设 |
| 2 | **Task 2 和 Task 6 都定义了 `LLMAdapter`**——两个权威位置 | `PLAN.md` Task 2 / Task 6 | **中** | Task 2 的 types.ts 不再定义 LLMAdapter；委托给 llm/adapter.ts |
| 3 | **Task 6 Vitest 测试无法验证纯类型接口**——Vitest 擦除类型导入，即使 `adapter.ts` 不存在也能通过 | `PLAN.md` Task 6 测试 | **高** | 验证命令更新为 `tsc --noEmit`；Vitest 仅保留为运行时测试 |
| 4 | **`MockLLMExhaustedError` API 未定义**——未指定定义文件、导出风格、构造函数参数或错误消息 | `PLAN.md` Task 7 行为 | **中** | 已补充：从 `mock.ts` 导出、`extends Error`、无参构造、消息 `"MockLLMAdapter: no more responses"` |
| 5 | **响应数组所有权不明确**——`shift()` 会修改调用者的数组 | `PLAN.md` Task 7 接口 | **中** | 已补充：构造函数浅复制数组；调用者数组不会被修改 |
| 6 | **TypeScript/Vitest 依赖声明太晚**——Task 42 才列出，但 Tasks 2、3、6、7 已需要编译 | `PLAN.md` Tasks 2-7 / Task 42 | **高** | 将 devDependencies 声明提前到 Phase 1（Task 1） |
| 7 | **Render vs Vercel 矛盾**——SPEC §3.7/§5 说 Render，§10/§11 说 Vercel | `SPEC.md` §10, §11 | **中** | 统一为 Render（后改为阿里云 ECS） |
| 8 | **PLAN 头部"278 tests passing"缺乏证据**——未说明来源或上下文 | `PLAN.md` 头部 | **中** | 已添加 "(current state as of 2026-08-03)" 限定 |

### 与初轮验证合并

初轮（ChatGPT）验证发现 3 个缺陷，均在 commit `be10126` 中修复：

| # | 缺陷 | 状态 | 与 Codex 发现的关系 |
|---|--------|--------|---------------------------|
| AgentContext 生命周期未定义 | 已在 `be10126` 修复 | Codex 未再次发现——确认修复充分 |
| AgentResponse 缺少调试字段 | 已在 `be10126` 修复 | Codex 未再次发现——确认修复充分 |
| Message→OpenAI 映射缺失 | 已在 `be10126` 修复 | Codex 未再次发现——确认修复充分 |

**合并发现的结论：** 初轮验证有用但浅显——它识别了 3 个真实问题，但遗漏了另外 8 个只有在全新 agent 实际尝试实现代码时才会暴露的问题。这确认了 §4.5 的 rationale：**仅提问不实现，会严重高估规约的清晰度。**

### 解读偏差

| 解读 | 原始意图 | 根本原因 |
|---------------|----------------|------------|
| `types.ts` 不再定义 `LLMAdapter`；`llm/adapter.ts` 是唯一权威位置 | `types.ts` 应定义所有共享类型；`llm/adapter.ts` 重新导出 | SPEC/PLAN 歧义——两个定义没有优先级规则 |
| Mock 构造函数复制输入数组 | PLAN 未指定所有权 | SPEC/PLAN 遗漏——数组修改行为未定义 |
| 只实现 core 工作区，跳过 server/cli | 冷启动应只覆盖 Tasks 6/7 | 范围边界不清晰——Task 1 暗示了所有三个包 |

### 已做的修订

基于验证发现，已应用以下修订：

| 文件 | 修订内容 | Commit |
|------|----------|--------|
| `SPEC.md` | 将 §10 和 §11 中的 "Vercel" 替换为 "Render"；统一部署目标 | `84a3530` |
| `PLAN.md` | Task 2: 移除 `LLMAdapter` 接口定义（委托给 Task 6）。Task 6: 在验证命令中添加 `tsc --noEmit`。Task 7: 补充 `MockLLMExhaustedError` API 规范、数组复制语义。Task 1: 添加 devDependencies（TypeScript、Vitest） | `be10126` + `c4c36ec` |
| `cold-start-prompt.md` | 移除 "existing `types.ts`" 假设，添加脚手架说明 | `fdb4e2e`（已删除） |

### 评估

**SPEC 质量：中等。** Codex agent 能够正确实现 Tasks 6 和 7，所有测试通过。然而，发现了 8 个缺陷——其中 3 个为高严重度。主要问题是：

1. **任务依赖图不明确**——PLAN 未明确说明 Tasks 6/7 依赖 Tasks 1-3（脚手架 + 类型 + 测试配置）。新 agent 必须自行推断。
2. **测试验证空缺**——纯类型接口无法仅用 Vitest 测试；需要 `tsc --noEmit`。这是 TypeScript 特有的教训，影响了测试设计。
3. **未定义的错误类型**——即使是像"`MockLLMExhaustedError` 在哪里"这样简单的事情也需要明确的规范。将细节留给"实现者判断"会产生歧义。

**关键教训：** 30 分钟的实现练习发现的缺陷比之前的纯对话轮次更多。这确认了 §4.5 的主张：**冷启动实现是规约质量最有价值的反馈信号。**