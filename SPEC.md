# SPEC：Coding Agent Harness 本地交付规约

> 当前规约以仓库可验证实现和 2026-08-12 final-delivery hardening 证据为准。

## 1. 产品目标与非目标

Coding Agent Harness 为单用户、单机编码任务提供可审计的 Agent 工程层。LLM 决定下一步动作；Harness 负责上下文、工具分发、治理、测试反馈、记忆、会话和凭据生命周期。

交付目标：

- 在本地可信模式运行真实 LLM 和完整工具集。
- 用确定性测试证明危险动作审批、反馈导致的下一步修正和项目记忆隔离。
- 用本地 CLI 或 WebUI 提供同一 Server 能力。
- 通过 release tarball 分发三个 workspace 包；最终附件地址只有发布后才能确认。

非目标：

- 不声明任何未经当前证据核验的外部在线服务或地址。
- 公开模式不是远程编码服务，不运行真实 LLM 或进程工具。
- 不提供多租户隔离，也不把本地可信模式作为共享服务暴露。

## 2. 运行模式与安全边界

### 2.1 `public`

`public` 是缺省安全模式，只运行服务端内置的确定性场景：

- 允许体验：`demo`
- 真实 LLM：禁用
- 公共 BYOK 与服务器凭据：禁用
- Shell、Git、测试子进程：禁用
- 输入输出：服务端从固定场景生成结构化 allowlist 事件，不回显任意格式输入

### 2.2 `local`

`local` 是用户机器上的完整可信模式：

- 允许 `demo`、本地 BYOK 和本地服务器凭据体验。
- 可运行文件、Shell、测试和 Git 工具，但所有动作仍经过 RuntimePolicy、ToolRegistry 和 Governance。
- 必须绑定 `127.0.0.1`、`localhost` 或等价回环地址。
- 服务端拥有 workspace root 和 session；客户端不能选择 `workingDir` 或伪造 session ID。

### 2.3 网络顺序

```text
POST /api/agent/sessions          -> sessionId, mode, capabilities, expiresAt
GET  /api/agent/stream/:sessionId -> SSE 事件流
POST /api/agent/run               -> sessionId, task, mode, local apiKey（仅 local BYOK）
```

客户端先创建 session，再打开 SSE，最后提交 run。未知字段和不符合策略的体验必须被拒绝。

## 3. 模块契约

### 3.1 `@harness/core`

#### AgentLoop

- 输入：任务、服务端分配的 `workingDir`、LLMAdapter、ToolRegistry、Governance、FeedbackLoop、MemoryStore、SessionStore 和配置。
- 输出：完成、失败、达到迭代限制、人工审批阻断或中止结果；同时产生会话和工具事件。
- 边界：循环只编排依赖，不自行绕过 Registry 执行工具；每轮检索当前项目最多 10 条相关记忆。
- 错误：LLM/工具/测试错误变成结构化反馈；危险动作返回审批要求；abort 后不得再授权或执行。

#### ToolRegistry 与 Governance

- 输入：带 `name`、`arguments` 的工具请求以及调用上下文。
- 输出：统一的成功/错误结果，或 `ToolApprovalRequiredError`。
- 边界：Registry 从已注册工具读取风险元数据；危险工具即使命令文本无害也必须进入治理。批准与动作的名称、参数和 ID 绑定，并且只消费一次。
- 错误：未知工具、参数校验失败、路径越界、策略禁止或审批拒绝都不得执行底层操作。

#### FeedbackLoop

- 输入：TestRunner 的 stdout、stderr、exit code 和工作目录。
- 输出：解析后的失败、分类、优先级和可执行修复上下文。
- 边界：Harness 生成结构化反馈，不生成代码补丁；下一轮 LLM 请求必须实际包含反馈，确定性 mock 才能选择修正动作。
- 错误：无法解析的输出保留原始摘要；FeedbackLoop 达到自身上限时停止继续，AgentLoop 达到总迭代上限时返回 `max_iterations`，不会自动创建人工介入请求。

#### MemoryStore

- 输入：强制的 `projectPath`、记忆条目或搜索文本、可选 limit。
- 输出：仅属于同一项目的持久化记忆。
- 边界：使用 `sql.js` 提供 SQLite 数据库能力；查询以参数化 `project_path` 过滤。实现不使用原生 SQLite 驱动。
- 错误：缺失项目身份、无效条目或数据库读写错误应显式失败，不能回退为跨项目搜索。

#### LLMAdapter 与 MockLLMAdapter

- 输入：messages、tools、memories 和 config 的请求视图。
- 输出：assistant 文本、工具调用或完成信号。
- 边界：真实适配器仅在 local 模式获得凭据；mock 可记录请求并依据下一轮消息中的反馈选择响应。
- 错误：供应商错误被归一化；mock 响应耗尽或 selector 无结果时显式报错。

### 3.2 `@harness/server`

#### App/RuntimePolicy

- 输入：`HARNESS_MODE`、服务端 workspace root、可注入存储和速率限制配置。
- 输出：Express API、SSE 和静态 React WebUI。
- 边界：policy 决定注册哪些工具和体验；客户端 UI 只能展示服务端下发的 capability。
- 错误：失效 session、越权体验、未知字段、超过速率/并发限制返回明确 HTTP 错误，不泄露秘密。

#### CredentialStore

- 输入：API Key、至少 12 字符主密码和生命周期动作（initialize/update/unlock/lock/clear）。
- 输出：只含状态的响应；不得返回 Key 或主密码。
- 边界：默认文件是 `~/.harness/credentials.enc`，使用 `scrypt` 与 AES-256-GCM；重启后为 locked。
- 错误：错误主密码解锁返回失败，锁定状态写入显式失败。现有但无法解析的 envelope 被识别为 `legacy`，本地 `POST /key` 初始化流程可用新主密码与 Key 覆盖它；它不会被单独报告为“损坏文件”。响应仍经过 secret redaction。

`HARNESS_CREDENTIALS_FILE` 是**仅供本地测试隔离的覆盖项**。非空值经 `trim` 后解析为绝对路径并显式传给 CredentialStore；未设置或空白时仍使用 `~/.harness/credentials.enc`。该变量不把凭据变成明文，也不改变加密格式。

### 3.3 `@harness/cli`

- 输入：`HARNESS_MODE`、`HOST`、`PORT` 等 Server 环境配置。
- 输出：启动安装包中的 Server，并尝试打开本地浏览器。
- 边界：通过 `@harness/server` 的 package metadata 解析入口，不使用 monorepo 相对路径；默认 host 为 `127.0.0.1`。
- 错误：Server 包缺失、启动失败或浏览器打开失败应输出非秘密错误并以非零状态结束。

## 4. 数据与凭据

| 数据 | 实现 | 默认位置/生命周期 |
| --- | --- | --- |
| 项目记忆 | `sql.js` SQLite | Server workspace 内的项目隔离数据库 |
| 会话 | JSON SessionStore | 本地 `.harness-sessions` |
| 项目配置 | YAML | 项目 `.harness/config.yaml` |
| 服务器凭据 | scrypt + AES-256-GCM | `~/.harness/credentials.enc` |
| BYOK Key | 请求/组件内存 | 运行完成、失败、切换或卸载即清除 |

本地 BYOK 不写入 localStorage、sessionStorage、URL、日志、分析状态或会话。服务器凭据只能由本地用户通过主密码生命周期管理；忘记主密码不能恢复 Key。

## 5. 分发与启动

主交付形态是 GitHub Release 附件中的三个 npm tarball：Core、Server、CLI。发布者必须先构建、检查 tarball 内容，再上传附件。此规约不预测 tag、文件名或最终下载 URL。

源码运行：

```powershell
npm.cmd ci
npm.cmd run build
$env:HARNESS_MODE = "local"
$env:HOST = "127.0.0.1"
npm.cmd start --workspace @harness/server
```

CLI 运行：先构建三个包，再执行 `npm.cmd start --workspace @harness/cli`；已安装 tarball 提供 `harness` 命令。

## 6. 验收证据边界

- Task 1：危险工具的风险元数据、不可变动作匹配、一次性批准和 abort 边界有回归测试。
- Task 2：记忆查询/删除按项目隔离，AgentLoop 获得受限的项目记忆。
- Task 3：下一轮 mock 行动只在观察到结构化反馈时变化；Core/Server demo 测试通过。
- Task 4：包入口和 stale chunk 已有测试；用户提供了人工 clean-install、健康页、WebUI 和停止监听成功证据。完整 Windows 自动清理验证没有形成闭合成功证据。
- Task 5：本地 fake-credential HTTP 生命周期使用隔离文件测试，Server 185 项测试和 Server build 在任务报告中通过。

测试数量只在对应任务、命令和日期的证据范围内有效；本规约不把历史总数当作当前全仓保证。

## 7. 已知限制

- Windows PowerShell 应使用 `npm.cmd`；部分 Shell 工具仍假设类 Unix 命令。
- CLI 自动打开浏览器要求图形桌面；无桌面时手动访问回环地址。
- 单用户、本地可信模型不提供多租户安全隔离。
- ResultParser 主要覆盖 Jest/Vitest 风格；其他测试框架需要插件。
- Task 4 自动化 Windows 安装/清理间隙仍未核验，不能用人工结果替代。
- 仓库没有已核验的公共完整产品端点；任何发布/托管动作都需要独立安全与运维验证。
