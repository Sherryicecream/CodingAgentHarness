# SPEC: Coding Agent Harness

> AI4SE 期末项目 · A 类 · Coding Agent Harness
> 2026-07-25

---

## 1. 问题陈述

### 要解决什么问题？

当前 AI 编码工具（Claude Code、Cursor、Copilot 等）能生成代码，但普遍缺乏**可靠的反馈闭环**——工具写代码后是否运行测试、是否根据测试结果修正，往往依赖 LLM 自行判断（一句提示词），而非确定性工程机制。本项目要构建一个 **Coding Agent Harness**，将反馈闭环作为一等公民编码进系统：写代码 → 自动运行测试 → 解析失败 → 分类错误 → 回灌修正 → 循环直到通过。

### 目标用户

希望通过 AI 辅助编程，但需要**可控、可审计、可纠错**的开发者。他们不信任"全靠 LLM 自觉"的黑盒，而是需要一个有确定性工程保证的工具。

### 为什么值得做？

Agent = LLM + Harness。LLM 只负责"决定下一步做什么"，而 harness 负责把这一决策变成稳定、可靠、可自我修正的系统。当 LLM 能力趋同时，工程化的 harness 层才是区分真正有用工具和"聊天机器人套壳"的关键。

---

## 2. 用户故事

| # | 用户故事 | 验收标准 |
|---|---------|---------|
| 1 | 作为开发者，我输入一个编程任务，agent 能自动编写代码并运行测试 | 输入任务后，agent 产出代码文件 + 测试结果 |
| 2 | 作为开发者，当 agent 写的代码导致测试失败时，它能自动分析失败原因并修正代码 | 注入失败后，agent 在 5 轮内修正到测试通过 |
| 3 | 作为开发者，当 agent 试图执行危险命令（如 `rm -rf`）时，系统会拦截并要求我确认 | 危险命令被拦截，未经确认不执行 |
| 4 | 作为开发者，我能在 Web 面板上实时看到 agent 在做什么、每步工具调用及其结果 | Web 面板显示当前 agent 状态和工具调用记录 |
| 5 | 作为开发者，我能查看历史会话，回顾 agent 的决策过程和修正次数 | 历史会话页面列出所有会话，可展开查看详情 |
| 6 | 作为开发者，首次使用时有安全引导帮我配置 API Key（隐藏输入、不写磁盘明文） | 引导流程完成，key 存入主密码保护的 AES-256-GCM 加密文件 |
| 7 | 作为开发者，我可以通过配置文件声明 agent 的行为规则（如"不要修改 src/config 下的文件"） | 配置规则被 agent 遵守，违规操作被拦截 |

---

## 3. 功能规约

### 3.1 Agent 主循环（裸循环 + 扩展点）

**设计原则**：AgentLoop 本身是一个**最小编排核心**，不包含任何具体业务逻辑。所有机制（工具、护栏、反馈、记忆、LLM 调用）均通过接口注入，循环只负责按顺序调用它们。这确保了：
- 每个机制可独立 mock 测试（替换单个注入即可）
- 新增机制无需修改循环代码（开闭原则）
- 循环本身是确定性状态机（移除 LLM 后仍可单测）

**裸循环骨架**：
```
1. ContextBuilder.build(task, memory, config) → 构建上下文
2. Guardrail.preCheck(action)                → 护栏预检
3. LLMAdapter.sendMessage(context)           → 调用 LLM
4. ResponseParser.parse(response)            → 解析动作
5. Guardrail.postCheck(action)               → 护栏后检
6. ToolRegistry.execute(action)              → 分发执行
7. FeedbackLoop.run(workingDir)              → 反馈闭环
8. StopCondition.check(state)                → 停机判断
9. 若未停机 → 回到第 1 步（携带反馈状态）
```

**上下文生命周期**：
- `AgentContext` **每轮循环重新创建**，由 `ContextBuilder.build()` 构建
- `messages` 包含**截止当前轮次的所有历史消息**（累积增长）
- `feedbackState` 由 `AgentLoop` 维护，上一轮反馈闭环的结果写入 `feedbackState.lastResult`，轮次计数写入 `feedbackState.iteration`
- `memory` 由 `MemoryStore` 在循环外管理，每轮构建上下文时查询并注入
- `config` 在 AgentLoop 启动时加载一次，循环内不变
```

**六大维度如何映射到扩展点**：

| 维度 | 对应扩展点 | 注入方式 |
|------|-----------|---------|
| 决策封装 | AgentLoop 编排逻辑本身 | 内置 |
| 动作/工具 | ToolRegistry | 构造注入 |
| 上下文与记忆 | ContextBuilder + MemoryStore | 构造注入 |
| 治理护栏 | Guardrail（preCheck + postCheck） | 构造注入 |
| 反馈闭环 | FeedbackLoop | 构造注入 |
| 配置 | ConfigLoader → 各组件读取 | 启动时加载 |

**扩展点**（协作/多 agent）预留但不深入实现：
- `AgentLoop` 可被包装为 `Tool`，从而支持多 agent 编排（子 agent 作为工具调用）

**Message 类型与 OpenAI 格式映射**：
- `role: "system"` → OpenAI `role: "system"`，content 为系统提示
- `role: "user"` → OpenAI `role: "user"`，content 为任务描述
- `role: "assistant"` → OpenAI `role: "assistant"`，若含 toolCalls，额外映射 `tool_calls` 字段
- `role: "tool"` → OpenAI `role: "tool"`，需携带 `tool_call_id` 对应某次 tool call 的 id
- `name` 字段映射为 OpenAI 的 `name`（用于工具消息标识工具名）

- **输入**：用户自然语言任务描述
- **行为**：组织上下文 → 护栏预检 → 调用 LLM → 解析动作 → 工具分发 → 反馈回灌 → 停机判断
- **输出**：任务完成 / 失败 / 需要人工介入
- **停机条件**：任务完成（LLM 声明完成 + 测试通过）或 达到最大轮次（20 轮）或 用户手动终止
- **错误处理**：LLM 调用失败重试 3 次；工具执行异常回灌给 LLM 尝试修复

### 3.2 工具系统

| 工具 | 功能 | 风险等级 |
|------|------|---------|
| `read_file` | 读取文件内容 | safe |
| `write_file` | 写入/创建文件 | moderate |
| `execute_shell` | 执行 shell 命令 | moderate |
| `run_tests` | 运行项目测试 | safe |
| `search_code` | 代码搜索 (grep) | safe |
| `git_diff` | 查看 git 变更 | safe |
| `git_commit` | 提交代码 | dangerous |

- **参数校验**：每个工具有 Zod schema 校验参数
- **结果格式化**：统一 `{ success, output, error? }` 结构

### 3.3 反馈闭环 ★ 重点维度

- **流程**：TestRunner → ResultParser → FailureClassifier → FixSuggestionBuilder → 回灌 AgentLoop
- **TestRunner**：执行 `npm test` 等测试命令，捕获 stdout/stderr/exit code
- **ResultParser**：解析测试输出，提取失败文件、行号、错误类型、diff
- **FailureClassifier**：规则引擎分类为 syntax / assertion / timeout / runtime
- **FixSuggestionBuilder**：构建结构化修复上下文注入到下一轮 LLM 调用
- **循环控制**：最多 5 轮修正，超出则提示人工介入
- **可 Mock**：TestRunner 可注入 mock 输出，其余步骤为纯函数

### 3.4 护栏系统

- **危险命令列表**：`rm -rf`、`DROP TABLE`、`git push --force`、`npm publish`、`chmod 777`、任何包含 `>/dev/sda` 的操作
- **拦截行为**：暂停 agent 循环，向用户展示命令详情，等待确认/拒绝
- **白名单**：用户可在配置中声明可信目录或命令前缀
- **HITL 状态机**：`running → blocked → waiting_user → approved → running` 或 `running → blocked → waiting_user → rejected → running(跳过)`

### 3.5 记忆系统

- **存储**：SQLite 本地数据库，按项目组织
- **记忆类型**：convention（代码规范）、decision（设计决策）、knowledge（代码库知识）、rule（用户规则）
- **检索**：基于关键词 + 可选向量相似度，按需注入上下文
- **跨会话持久化**：记忆按项目路径关联，同一项目不同会话共享记忆

### 3.6 配置系统

- **配置位置**：项目根目录 `.harness/config.yaml`
- **可配置项**：工具白名单/黑名单、最大轮次、测试命令、文件忽略规则、危险命令自定义列表
- **加载时机**：Agent 启动时加载，变更需重启

### 3.7 Web 应用 ★ 主入口

- **线上部署**：部署到阿里云 ECS（Docker 容器化），用户通过浏览器打开即用，零安装
- **对话界面**：类似 ChatGPT 的对话式编程体验，输入任务 → agent 实时执行
- **实时监控**：SSE 推送每步循环状态——LLM 调用、工具执行、护栏检查、反馈运行
- **历史回顾**：会话列表，可展开查看完整对话历史和每一轮反馈修正记录
- **配置管理**：Web 界面配置 API Key（隐藏输入）、项目规则、工具白名单
- **HITL 交互**：危险命令拦截时，在 Web 界面弹出确认框，等待用户批准/拒绝
- **技术**：Express + React (Vite) 全栈应用，`@harness/server` 包

### 3.8 CLI 工具（可选辅助）

- **命令**：`harness`（启动本地 Agent Server + 打开浏览器）、`harness config`（命令行凭据管理）
- **定位**：为偏好终端的用户提供本地运行选项，功能与 Web 版一致
- **技术**：轻量封装，复用 `@harness/core`

---

## 4. 非功能性需求

### 性能
- Agent 主循环单步延迟 < 500ms（不含 LLM API 调用）
- Web 面板首次加载 < 2s
- SQLite 记忆查询 < 100ms

### 安全（凭据威胁模型）

| 威胁 | 对策 |
|------|------|
| API Key 硬编码 | 代码中无任何 key，仅从解锁后的内存或显式部署环境变量读取 |
| API Key 提交到 Git | `.gitignore` 覆盖；pre-commit hook 扫描 |
| API Key 泄露到日志 | 日志输出前过滤替换为 `***` |
| 进程环境变量可见 | 本地默认不依赖环境变量；部署环境变量属于显式运维配置 |
| 首次运行无引导 | 引导式输入 API Key 与至少 12 字符主密码 → scrypt + AES-256-GCM 加密存储 |

### 可用性
- 零安装：打开浏览器即可使用（线上版）
- 本地备选：`npm install -g @harness/cli` + `harness`
- 首次使用自动引导配置 API Key
- 错误信息清晰，指明是哪个环节失败

### 可观测性
- 所有工具调用有日志记录
- 反馈闭环每轮迭代有统计（失败数、修正是否成功）
- Web 面板可视化展示运行状态

---

## 5. 系统架构

**Web 优先架构**：Web 应用是用户的主要入口，部署在阿里云 ECS（Docker 容器化），浏览器打开即用。

```
┌──────────────────────────────────────────────────┐
│              浏览器 (用户入口)                      │
│         http://47.98.97.255:3000                      │
└─────────────────────┬────────────────────────────┘
                      │ HTTP + SSE
┌─────────────────────┴────────────────────────────┐
│                 @harness/server                    │
│          (Express + React 全栈应用)                 │
│                                                    │
│  ┌──────────────┐  ┌───────────────────────────┐ │
│  │  React UI    │  │  Agent Server (内嵌)       │ │
│  │  ├ 对话界面   │  │  ┌─────────────────────┐  │ │
│  │  ├ 工具调用   │  │  │  @harness/core      │  │ │
│  │  ├ 历史回顾   │  │  │  (完整 harness 内核)  │  │ │
│  │  └ 配置管理   │  │  └─────────────────────┘  │ │
│  └──────────────┘  └───────────────────────────┘ │
└──────────────────────────────────────────────────┘
                      │
┌─────────────────────┴────────────────────────────┐
│                  @harness/core                     │
│          (纯逻辑库，无 UI 依赖，可单测)              │
│                                                    │
│  ┌─────────┐ ┌──────────┐ ┌───────────────────┐ │
│  │AgentLoop│ │ToolRegistry│ │Guardrail         │ │
│  │(主循环)  │ │(工具分发)  │ │(危险动作拦截)     │ │
│  └────┬────┘ └──────────┘ └───────────────────┘ │
│       │                                           │
│  ┌────┴────────────────────────────────────────┐ │
│  │          FeedbackLoop ★ 重点深入 ★           │ │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────┐  │ │
│  │  │TestRunner│ │ResultParser│ │FixStrategy │  │ │
│  │  └──────────┘ └──────────┘ └────────────┘  │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  ┌──────────┐ ┌──────────────┐ ┌──────────────┐ │
│  │MemoryStore│ │ConfigLoader  │ │LLMAdapter    │ │
│  └──────────┘ └──────────────┘ └──────────────┘ │
└─────────────────────────────────────────────────┘
                      │
┌─────────────────────┴────────────────────────────┐
│               @harness/cli (可选)                  │
│     (本地终端工具，连接 Agent Server 或独立运行)     │
│              依赖: @harness/core                   │
└──────────────────────────────────────────────────┘
```

### 交互流程

```
用户打开浏览器 → 输入任务 → Server 收到请求
  → 启动 AgentLoop（上下文 → LLM → 工具 → 反馈 → 循环）
  → 每步通过 SSE 推送给前端实时展示
  → 任务完成 → 会话存入历史 → 用户可查看/回顾
```

---

## 6. 数据模型

### 会话
```typescript
interface Session {
  id: string;
  createdAt: Date;
  task: string;
  messages: Message[];
  toolCalls: ToolCallRecord[];
  feedbackRuns: FeedbackRun[];
  status: "running" | "blocked" | "completed" | "failed";
  conclusion: string | null;
}
```

### 工具调用记录
```typescript
interface ToolCallRecord {
  timestamp: Date;
  toolName: string;
  params: Record<string, unknown>;
  result: ToolResult;
  guardrailCheck: "passed" | "blocked" | "approved_by_user";
}
```

### 反馈运行记录
```typescript
interface FeedbackRun {
  iteration: number;
  testResult: "pass" | "fail";
  failureCount: number;
  fixApplied: boolean;
  timeSpent: number;
}
```

### 记忆条目
```typescript
interface MemoryEntry {
  id: string;
  type: "convention" | "decision" | "knowledge" | "rule";
  content: string;
  source: string;
  createdAt: Date;
  lastAccessedAt: Date;
}
```

### 存储方案
| 数据 | 存储 | 位置 |
|------|------|------|
| 会话记录 | JSON 文件 | `~/.harness/sessions/` |
| 记忆 | SQLite | `~/.harness/memory.db` |
| 配置 | YAML | `.harness/config.yaml` |
| 凭据 | 主密码保护的加密文件 | `~/.harness/credentials.enc`，scrypt + AES-256-GCM |

---

## 7. 凭据与分发设计

### 凭据管理流程
1. 首次运行或旧版文件迁移 → 输入 API Key 与至少 12 字符主密码
2. 使用随机 salt/IV，通过 scrypt 派生密钥并以 AES-256-GCM 加密写入 `~/.harness/credentials.enc`
3. 重启后凭据处于 locked 状态，必须显式解锁；API 响应只返回状态，不回显明文
4. 解锁后可更新、测试、锁定或清除；忘记主密码无法恢复，需重新配置
5. `DEEPSEEK_API_KEY` 仅作为显式部署环境变量来源，不写入该文件

### 公开/本地安全模式

#### HARNESS_MODE

Harness 通过 `HARNESS_MODE` 环境变量控制运行模式：

- **`public`**（默认）：匿名访问，仅提供确定性的安全演示和服务器凭据体验；不暴露本地凭据、文件系统、Shell、Git 或公网 BYOK 能力。
- **`local`**：完整可信模式，保留所有本地工具、凭据管理和配置功能。

未设置或无效值默认解析为 `public`。

#### 能力模型

服务端下发的能力集来自 `RuntimePolicy`，通过 session 创建响应返回客户端：

```typescript
interface RuntimeSession {
  sessionId: string;
  mode: 'public' | 'local';
  capabilities: {
    allowedExperiences: Array<'demo' | 'byok' | 'server'>;
    allowByok: boolean;
    allowProcessTools: boolean;
    allowServerCredentials: boolean;
  };
  expiresAt: string;
}
```

客户端不得自行推断或启用能力。所有能力由服务端策略决定。

#### 信任边界

- **Session ID**：由服务端生成，客户端不生成或发送 session ID。
- **工作区**：服务端拥有工作区根目录（`HARNESS_WORKSPACE_ROOT`），客户端不发送 `workingDir`，`workingDir` 被拒绝为未知请求字段。
- **Key 生命周期**：BYOK Key 仅存在于浏览器组件内存中，通过 HTTPS 请求发送。Key 在以下情况均被清除：
  - 运行成功完成
  - 运行失败或发生错误
  - SSE 连接超时或中断
  - 用户切换体验模式
  - 组件卸载
- Key 不写入 localStorage、sessionStorage、URL、日志、分析工具、全局状态或上下文存储。
- Key 不回显到验证/错误提示文本中。

#### 公开演示

公开演示使用服务端内置的确定性场景运行器，不调用真实 LLM、不执行子进程：
- 使用 `createPublicDemoRunner` 在服务端进程内执行
- 展示安全文件写入、危险操作拦截、护栏反馈修正
- 所有事件使用结构化 allowlist 投影，确保任意格式用户输入不回显

#### BYOK 安全要求

- 生产环境必须通过 HTTPS 访问
- `localhost`、`127.0.0.1`、`::1` 等 loopback 地址可在 HTTP 下开发调试
- 非 HTTPS 非 loopback 环境下 BYOK 禁用，显示 HTTPS 说明
- DeepSeek 适配器在 run 路径内从请求 Key 构建，不附加到 session 状态
- 发出值通过 secret-redactor 清理，SSE 红化上下文在 close 时清除

#### 网络流

```
POST /api/agent/sessions          → { sessionId, mode, capabilities, expiresAt }
GET  /api/agent/stream/:sessionId → SSE 事件流（等待连接打开后）
POST /api/agent/run               → { sessionId, task, mode, apiKey? }
```

严格顺序：session 创建 → SSE 连接 → 运行提交。客户端不生成 session ID，不发送 workingDir。

#### 速率限制

- 默认：20 次运行尝试/小时/IP
- 默认：2 个并发运行/IP
- 通过 `RATE_LIMIT_MAX`、`RATE_LIMIT_WINDOW`、`CONCURRENT_MAX` 环境变量覆盖
- 请求体限制：64 KB JSON

#### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HARNESS_MODE` | `public` | 运行模式：`public` 或 `local` |
| `HARNESS_WORKSPACE_ROOT` | 系统临时目录 | 服务端工作区根目录 |
| `PORT` | `3000` | HTTP 监听端口 |
| `HOST` | `0.0.0.0` | HTTP 监听地址 |
| `DEEPSEEK_API_KEY` | — | 服务端 DeepSeek API Key（本地模式） |
| `HARNESS_TRUST_PROXY` | `0` | 反向代理信任跳数（用于 HTTPS 检测） |
| `RATE_LIMIT_MAX` | `20` | 每小时每 IP 最大运行尝试次数 |
| `RATE_LIMIT_WINDOW` | `3600000` | 速率限制窗口（毫秒） |
| `CONCURRENT_MAX` | `2` | 每 IP 最大并发运行数 |

#### 威胁模型

- **范围内**：从文件系统窃取凭据、日志泄露、Git 暴露、浏览器 XSS 读取 Key、CSRF 未授权运行
- **范围外**：内存扫描、内核级攻击、依赖供应链攻击、Windows 同账户恶意进程（非远程公开威胁模型）

### 分发

| 项目 | 决策 |
|------|------|
| **主形态** | 阿里云 ECS 部署（Docker 容器化），浏览器打开即用；备选 Render 免费版 |
| **辅助形态** | npm 包 `@harness/cli`（本地运行） |
| 包结构 | `@harness/core` + `@harness/server` + `@harness/cli` |
| 线上 URL | `http://47.98.97.255:3000`（阿里云 ECS）或 `https://harness.onrender.com`（Render 备选） |
| 本地安装 | `npm install -g @harness/cli` |
| 本地运行 | `harness`（启动本地服务器 + 打开浏览器） |
| 平台 | Node.js 18+，Windows / macOS / Linux |
| 容器运行 | `docker build -t harness . && docker run -d -p 3000:3000 -e DEEPSEEK_API_KEY=xxx harness` |
| 已知限制 | Render 免费版 15 分钟无请求休眠，唤醒需 30-50 秒；阿里云 ECS 需自行配置安全组和域名；凭据使用加密文件存储或环境变量 |

---

## 8. 领域与机制设计（A 类额外要求）

### 领域分析（Coding 场景）

| 维度 | 具体内容 |
|------|---------|
| **反馈信号** | 测试结果（pass/fail）、lint 输出、类型检查错误——客观、确定、可解析 |
| **危险动作** | `rm -rf`、`DROP TABLE`、`git push --force`、`npm publish`、修改 `.git` 目录 |
| **所需工具** | 文件读写、shell 执行、测试运行、代码搜索、git 操作 |
| **记忆需求** | 项目代码规范、历史设计决策、用户偏好、常见错误模式 |

### 重点维度：反馈闭环

**为何选它**：Coding Agent 的核心价值是"写错了能自己发现并修正"。治理（护栏）更多是模式匹配，记忆自己实现存储检索工程量大但核心逻辑薄——反馈闭环在工程深度和工作量之间平衡最好。

**编码实现（非提示词）**：
1. `TestRunner.run()` — 执行测试命令，捕获输出
2. `ResultParser.parse(output)` — 正则+AST 解析，提取文件/行号/错误类型/diff
3. `FailureClassifier.classify(failures)` — 规则引擎分类为 syntax/assertion/timeout/runtime
4. `FixSuggestionBuilder.build(failures)` — 构建结构化修复上下文
5. 回灌到 `AgentLoop` — 下一轮 LLM 调用携带 `feedbackState`
6. 循环控制 — 最多 5 轮，超出人工介入

**全部可 Mock 测试**：每一步都是纯函数或注入依赖，无需真实 LLM。

---

## 9. 技术选型与理由

| 技术 | 选择 | 理由 |
|------|------|------|
| 语言 | TypeScript | 类型安全，npm 生态，适合 monorepo 结构 |
| 运行时 | Node.js 18+ | LTS 版本，稳定 |
| LLM 供应商 | DeepSeek | API 兼容 OpenAI 格式，性价比高，国内可访问 |
| LLM SDK | `openai` npm 包 | 兼容 DeepSeek API，生态成熟 |
| Web 框架 | Express + React (Vite) | Express 轻量稳定，React 生态成熟 |
| 设计系统 | Open Design | 使用 Open Design 方法论定义 DESIGN.md，含完整的颜色/字体/间距/组件规范 |
| CLI 框架 | 轻量封装 | 复用 core，不引入重量级 CLI 框架 |
| 数据库 | better-sqlite3 | 零配置本地 SQLite，同步 API |
| 凭据存储 | 主密码保护的 scrypt + AES-256-GCM 加密文件 | 跨平台；环境变量仅作为显式部署来源 |
| 测试框架 | Vitest | 快，TypeScript 原生支持 |
| 打包 | tsup | 轻量 TypeScript 打包 |
| 部署 | 阿里云 ECS (Docker) | 国内可访问，弹性计算，按量付费 |
| 备选部署 | 阿里云 ECS (Docker) / Render (备选免费版) | 国内可访问，弹性计算；Render 海外节点，750h/月免费额度 |
| CI | GitHub Actions | 仓库在 GitHub，使用 `.github/workflows/ci.yml` |
| monorepo | npm workspaces | 原生支持，无需额外工具 |

---

## 10. 验收标准

| 功能 | 验收标准 |
|------|---------|
| Agent 主循环 | 输入任务 → agent 产出代码，循环可被 mock LLM 驱动测试 |
| 反馈闭环 | 注入测试失败 → agent 在 5 轮内修正到通过（mock 下可验证） |
| 护栏 | 传入危险命令 → 被拦截，等待用户确认 |
| 工具系统 | 所有工具可注册、可执行、参数校验正确 |
| 记忆 | 跨会话可读写记忆，按项目隔离 |
| CLI | `harness` 启动本地服务，浏览器可访问 |
| Web 线上部署 | 阿里云 ECS 部署，公网 URL 可访问，功能完整 |
| 凭据 | 首次运行引导配置，key 不入源码、不入 Git、不入日志 |
| 分发 | `npm install -g` 后可运行 |
| Mock 测试 | 所有核心机制有 mock LLM 驱动的确定性单元测试 |
| 机制演示 | 可复现：护栏拦截、反馈修正、重点维度行为 |

---

## 11. 风险与未决问题

| 风险 | 缓解措施 |
|------|---------|
| DeepSeek 工具调用稳定性不如 Claude | 抽象层支持切换供应商，失败时重试 |
| 测试输出格式多样（Jest/pytest/go test） | ResultParser 采用插件式，先支持 Jest |
| 反馈闭环可能多轮修正失败 | 最多 5 轮，超出后暂停请求人工介入 |
| 记忆系统复杂度可能超出时间 | 先做关键词检索，向量检索作为可选增强 |
| SSE 实时推送在 Render 下可用 | Render 支持长连接（Web Service），非 Serverless，没问题 |
| Render 免费版 15 分钟休眠 | 休眠后自动唤醒（30-50s），接受此限制；或用 cron job 定时唤醒 |
| 忘记主密码 | 无法恢复文件中的 API Key，需重新配置 |
| 线上版 API Key 存储安全 | Render 环境变量加密存储，传输层 HTTPS，不落盘 |
