# Coding Agent Harness

TypeScript 实现的编码智能体工作台（Harness）。**Agent = LLM + Harness。** Harness 提供工程层：主循环、工具、护栏、反馈闭环、记忆和配置。

---

## 这是什么？

本项目实现了一个编码智能体的 **Harness（工作台）** 侧——围绕 LLM 构建的确定性软件基础设施，将 LLM 从文本生成器转变为可靠的编码助手。Harness 是"工程"部分；LLM 是"智能"部分。

Harness 提供六大核心机制：

1. **Agent 主循环** — 驱动 LLM-工具-反馈循环的核心编排
2. **工具系统** — 文件系统、Shell、Git、代码搜索和测试执行
3. **护栏 + 人工审批（HITL）** — 拦截危险命令并需要人工确认的安全检查
4. **反馈闭环（核心贡献）** — 自动化的测试驱动修复迭代：运行测试、分类失败、构建修复建议、回灌给 LLM
5. **记忆系统** — 基于 SQLite 的跨会话知识存储与检索
6. **配置系统** — 声明式 YAML 配置，带安全凭据管理

---

## 架构

```
harness/
├── packages/
│   ├── core/          @harness/core  — 纯逻辑，可 Mock 测试，零 UI 依赖
│   ├── server/        @harness/server — Express + React 全栈应用
│   └── cli/           @harness/cli   — 可选 CLI 启动器
```

- **`@harness/core`**：所有确定性逻辑 —— LLM 适配器、工具注册表、护栏、HITL 状态机、反馈闭环（测试运行器、结果解析器、失败分类器、修复建议构建器）、记忆存储、配置加载器、Agent 主循环、会话存储。所有接口均可注入，整个系统可用 Mock LLM 进行测试。
- **`@harness/server`**：Express 服务器，提供 REST API + SSE 流式推送、React 前端（ChatPanel、ToolCallCard、GuardrailDialog、FeedbackTimeline、SessionHistory）。
- **`@harness/cli`**：最小化 CLI，启动服务器并打开浏览器。

---

## 快速开始

### 本地开发

```bash
# 安装依赖
npm install

# 构建所有包
npm run build

# 运行所有测试（278 个测试）
npm test

# 启动服务
cd packages/server && npm start
# 打开 http://localhost:3000
```

### 使用 CLI

```bash
cd packages/cli && npm run build && npm start
# 或：npx harness
```

### 使用 Docker

```bash
# 构建镜像
docker build -t harness .

# 运行容器
docker run -d -p 3000:3000 -e DEEPSEEK_API_KEY=your_key_here harness

# 打开 http://localhost:3000
```

### npm 包（全局安装）

```bash
# 全局安装 CLI
npm install -g @harness/cli

# 启动 Harness
harness
```

---

## 核心功能

### 1. Agent 主循环

主循环编排完整的 Agent 工作流：
- 从任务、工具、记忆和反馈状态构建上下文
- 调用 LLM 获取下一步动作
- 解析响应，提取工具调用
- 在护栏检查下执行工具
- 对测试结果运行反馈闭环
- 检查停机条件（任务完成、达到最大轮次、HITL 阻断）

### 2. 工具系统

七个内置工具：

| 工具 | 风险等级 | 公开模式 | 本地模式 | 描述 |
|------|---------|---------|---------|------|
| `read_file` | 安全 | ✅ | ✅ | 读取文件内容，带路径穿越防护 |
| `write_file` | 中等 | ✅ | ✅ | 写入文件，带 `.git` 保护 |
| `search_code` | 安全 | ✅ | ✅ | 代码搜索（模式匹配） |
| `execute_shell` | 中等 | ❌ | ✅ | 执行 Shell 命令，带超时限制 |
| `run_tests` | 安全 | ❌ | ✅ | 执行测试套件（反馈闭环的入口） |
| `git_diff` | 安全 | ❌ | ✅ | 查看 Git 工作区变更 |
| `git_commit` | 危险 | ❌ | ✅ | 提交代码（触发护栏 + HITL） |

### 3. 护栏 + 人工审批（HITL）

护栏系统在执行前拦截危险操作：
- 内置模式：`rm -rf`、`DROP TABLE`、`git push --force`、`npm publish`、`chmod 777`、磁盘格式化
- 人工审批（HITL）状态机：`running → blocked → waiting_user → approved/rejected → running`
- 可通过 `.harness/config.yaml` 配置自定义拦截命令

### 4. 反馈闭环（核心贡献）

反馈闭环是核心创新——自动化的测试驱动迭代：
1. **TestRunner** 执行测试套件
2. **ResultParser** 从测试输出中提取结构化失败数据（Jest/Vitest 插件）
3. **FailureClassifier** 分类失败类型（语法 / 断言 / 超时 / 运行时）并排序优先级
4. **FixSuggestionBuilder** 构建结构化修复上下文
5. **FeedbackLoop** 编排流水线，将结果注入 LLM 上下文

### 5. 记忆系统

跨会话知识存储：
- SQLite 持久化存储
- 四种记忆类型：约定（convention）、决策（decision）、知识（knowledge）、规则（rule）
- 关键词搜索与相关性排序
- 按项目隔离

### 6. 配置系统

声明式 YAML 配置（`.harness/config.yaml`）：
- `maxIterations`、`testCommand`、`allowedTools`、`blockedCommands`、`ignoredPaths`
- 默认值 + 用户覆盖
- 加载时自动校验

---

## 目录结构

```
packages/
├── core/
│   ├── src/
│   │   ├── types.ts              # 所有共享 TypeScript 接口
│   │   ├── index.ts              # 统一导出
│   │   ├── llm/                  # LLM 抽象层
│   │   │   ├── adapter.ts        # LLMAdapter 接口
│   │   │   ├── mock.ts           # MockLLMAdapter（确定性测试）
│   │   │   ├── deepseek.ts       # DeepSeekAdapter（真实 API）
│   │   │   └── response-parser.ts # 响应解析
│   │   ├── tools/                # 工具系统
│   │   │   ├── tool.ts           # ToolRegistry
│   │   │   ├── read-file.ts
│   │   │   ├── write-file.ts
│   │   │   ├── execute-shell.ts
│   │   │   ├── run-tests.ts
│   │   │   ├── search-code.ts
│   │   │   ├── git-diff.ts
│   │   │   └── git-commit.ts
│   │   ├── guardrail/            # 安全 + HITL
│   │   │   ├── guardrail.ts      # 命令模式匹配
│   │   │   ├── hitl.ts           # HITL 状态机
│   │   │   └── index.ts          # GovernanceService
│   │   ├── feedback/             # 反馈闭环（核心贡献）
│   │   │   ├── test-runner.ts
│   │   │   ├── result-parser.ts
│   │   │   ├── failure-classifier.ts
│   │   │   ├── fix-suggestion.ts
│   │   │   ├── feedback-loop.ts
│   │   │   └── index.ts
│   │   ├── memory/               # 记忆系统
│   │   │   └── memory-store.ts
│   │   ├── config/               # 配置
│   │   │   └── config-loader.ts
│   │   └── loop/                 # Agent 主循环
│   │       ├── agent-loop.ts
│   │       ├── context-builder.ts
│   │       ├── stop-condition.ts
│   │       └── session-store.ts
│   └── test/                     # 278 个测试
│       ├── llm/
│       ├── tools/
│       ├── guardrail/
│       ├── feedback/
│       ├── memory/
│       ├── config/
│       ├── loop/
│       └── demo/
├── server/
│   ├── src/
│   │   ├── server.ts             # Express 应用
│   │   ├── routes/
│   │   │   ├── agent.ts          # POST /api/agent/run + SSE
│   │   │   ├── session.ts        # GET /api/sessions
│   │   │   └── config.ts         # API Key 管理
│   │   └── sse/
│   │       └── sse-manager.ts    # SSE 连接管理
│   └── client/                   # React 前端
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── ChatPanel.tsx
│       │   │   ├── ToolCallCard.tsx
│       │   │   ├── GuardrailDialog.tsx
│       │   │   ├── FeedbackTimeline.tsx
│       │   │   └── SessionHistory.tsx
│       │   └── hooks/
│       │       └── useSSE.ts
│       └── vite.config.ts
└── cli/
    └── src/
        └── cli.ts                # CLI 入口
```

---

## 安全

### 运行模式

Harness 支持两种运行模式，通过 `HARNESS_MODE` 环境变量控制：

| 模式 | 值 | 说明 |
|------|-----|------|
| **公开安全模式** | `public` | 匿名演示 + 受限 BYOK，仅文件工具，无法执行 Shell/Git/进程测试 |
| **本地可信模式** | `local` | 完整工具集，支持服务器凭据管理，可执行 Shell/Git/进程测试 |

`HARNESS_MODE` 未设置或设置为无效值时，默认解析为 `public` 模式。

### 模式能力对比

| 能力 | 公开演示 | 公开 BYOK | 本地 |
|------|---------|-----------|------|
| `read_file` | ✅ | ✅ | ✅ |
| `write_file` | ✅ | ✅ | ✅ |
| `search_code` | ✅ | ✅ | ✅ |
| `execute_shell` | ❌ | ❌ | ✅ |
| `run_tests` | ❌ | ❌ | ✅ |
| `git_diff` | ❌ | ❌ | ✅ |
| `git_commit` | ❌ | ❌ | ✅ |
| 服务器凭据管理 | ❌ | ❌ | ✅ |
| 历史会话 | ❌ | ❌ | ✅ |
| 配置页 | ❌ | ❌ | ✅ |

### BYOK 安全要求

公开 BYOK（使用自己的 API Key）必须满足以下条件：

- **HTTPS 要求**：生产环境必须通过 HTTPS 访问。HTTP 下 BYOK 被禁用，仅显示说明信息。
- **开发例外**：`localhost`、`127.0.0.1`、`::1` 等 loopback 地址可在 HTTP 下开发调试。
- **Key 生命周期**：API Key 仅存在于浏览器组件内存中，通过本次请求发送。Key 在以下情况均被清除：
  - 运行成功完成
  - 运行失败或发生错误
  - SSE 连接超时或中断
  - 用户切换体验模式
  - 组件卸载
- **Key 永不持久化**：不写入 localStorage、sessionStorage、URL、日志、分析工具或全局状态。
- **Key 不回显**：Key 不会出现在验证/错误提示文本中。

### 公开演示的特殊行为

公开演示模式使用服务器内置的确定性场景运行器，不调用真实 LLM、不执行任何子进程：
- 演示过程完全在服务端进程内执行
- 展示安全文件写入、危险操作拦截、护栏反馈修正等核心机制
- 所有事件使用结构化 allowlist 投影，确保任意格式用户输入不回显

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HARNESS_MODE` | `public` | 运行模式：`public` 或 `local` |
| `HARNESS_WORKSPACE_ROOT` | 系统临时目录 | 服务器拥有的工作区根目录，客户端不可选择 |
| `PORT` | `3000` | HTTP 监听端口 |
| `HOST` | `0.0.0.0` | HTTP 监听地址 |
| `DEEPSEEK_API_KEY` | — | 服务端 DeepSeek API Key（本地模式） |
| `TRUST_PROXY` | `0` | 反向代理信任跳数（用于 HTTPS 检测） |
| `RATE_LIMIT_MAX` | `20` | 每小时每 IP 最大运行尝试次数 |
| `RATE_LIMIT_WINDOW` | `3600000` | 速率限制窗口（毫秒） |
| `CONCURRENT_MAX` | `2` | 每 IP 最大并发运行数 |

### 网络流

```
POST /api/agent/sessions          → { sessionId, mode, capabilities, expiresAt }
GET  /api/agent/stream/:sessionId → SSE 事件流（等待连接打开后）
POST /api/agent/run               → { sessionId, task, mode, apiKey? }
```

严格顺序：session 创建 → SSE 连接 → 运行提交。客户端不生成 session ID，不发送 workingDir。

### 威胁模型

- **范围内**：从文件系统窃取凭据、日志泄露、Git 暴露、浏览器 XSS 读取 Key、CSRF 未授权运行
- **范围外**：内存扫描、内核级攻击、依赖供应链攻击、Windows 同账户恶意进程（非远程公开威胁模型）

### 凭据存储（本地模式）

API Key 使用 AES-256-GCM 加密后存储在本地文件系统中：
- **加密文件**：`~/.harness/credentials.enc`
- **加密密钥**：由机器主机名 + 操作系统用户名派生
- **环境变量**：`DEEPSEEK_API_KEY`（生产部署用，优先级高于文件存储）

API Key 绝不会：
- 硬编码在源代码中
- 写入日志或文件
- 包含在 Git 提交中
- 在 API 响应中暴露（状态端点仅返回 `hasKey: boolean`）

---

## 部署

### Docker（推荐用于云部署）

```bash
# 构建并运行
docker build -t harness .
docker run -d -p 3000:3000 \
  -e DEEPSEEK_API_KEY=your_key_here \
  -e NODE_ENV=production \
  harness
```

### Docker Compose（带自动重启）

```yaml
version: '3'
services:
  harness:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DEEPSEEK_API_KEY=your_key_here
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

### 阿里云 ECS

1. 远程桌面登录到 Windows ECS 实例
2. 从 `https://nodejs.org` 安装 Node.js 22+
3. `git clone https://github.com/Sherryicecream/CodingAgentHarness.git`
4. `cd CodingAgentHarness && npm install && npm run build`
5. `cd packages/server && NODE_ENV=production npm start`
6. 配置安全组：入方向开放 3000 端口
7. 访问 `http://47.98.97.255:3000`

---

## 技术栈

| 层 | 技术 |
|-------|-----------|
| 语言 | TypeScript（严格模式） |
| 运行时 | Node.js 18+ |
| Web 服务器 | Express 4 |
| 前端 | React 19 + Vite |
| LLM | DeepSeek（兼容 OpenAI 格式） |
| 数据库 | SQLite（通过 sql.js） |
| 测试框架 | Vitest |
| 构建工具 | tsup |
| 部署 | 阿里云 ECS（Docker） |
| 包管理 | npm workspaces |

---

## 已知限制

1. **Windows Server 部署**：本项目为类 Unix 环境开发。在 Windows Server 上，请确保已安装 Node.js 22+ 且 Vite 前端构建成功。`npm run build` 命令会同时构建后端和前端。
2. **仅本地 Web 访问**：Web 界面设计为本地使用。远程部署需要配置安全组。
3. **测试解析器范围**：反馈闭环的 ResultParser 支持 Jest 和 Vitest 输出格式。其他测试框架（pytest、go test）需要自定义插件。
4. **单用户模式**：Harness 设计为单用户、单项目使用。不支持多租户或并发会话隔离。
5. **Windows 路径**：部分 Shell 命令假定 Unix 风格路径。在 Windows 上，建议使用 Git Bash 或 WSL 以获得完整兼容性。