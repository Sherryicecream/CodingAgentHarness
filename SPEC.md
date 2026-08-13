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

- 输入：DeepSeek API Key 与 set/delete/test 动作。
- 输出：只含 `{ storage, hasKey }` 状态；不得返回 Key。
- 边界：持久化只委托当前操作系统账户的凭据库；无主密码、无应用自建凭据文件。凭据库不可用时报告 `unavailable`，并保留请求内存中的“仅本次使用”。
- 错误：后端不可用返回非秘密错误，响应与日志不得包含 Key。

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
| 服务器凭据 | 操作系统凭据库 | 当前 OS 用户账户 |
| BYOK Key | 请求/组件内存 | 运行完成、失败、切换或卸载即清除 |

### 4.1 工作区文件保留

Session workspace 的保留策略为：

- `temporary`（默认）：任务完成或失败后可由 sweep 回收；运行中或未过期的 session 受保护。
- `preserve`：不会被自动 sweep 删除，直到用户手动清理。

用户主动导出使用 `POST /api/agent/sessions/:sessionId/save`。服务端按会话清单核对路径、大小和 SHA-256，再原子写入 `.harness/outputs/<session-id>/` 与 `manifest.json`；路径穿越、符号链接、摘要变化和覆盖既有导出必须拒绝。

### 4.2 DeepSeek 配置边界

产品只提供内置 DeepSeek 适配器，不暴露通用 Provider endpoint 或运行时 Provider 选择。凭据、网络目标和错误处理因此收敛到一个可审计边界。

本地“仅本次使用”不写入 localStorage、sessionStorage、URL、日志、分析状态或会话。“记住在此设备”只能由本地用户通过操作系统凭据库管理。

## 5. 分发与启动

主交付形态是 GitHub Release 附件中的三个 npm tarball：Core、Server、CLI。发布者必须先构建、检查 tarball 内容，再上传附件。此规约不预测 tag、文件名或最终下载 URL。

源码运行：

```powershell
npm.cmd ci
npm.cmd run build
$env:HARNESS_MODE = "local"
$env:HOST = "127.0.0.1"
$env:NODE_ENV = "production"
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

## 8. 问题、用户故事与价值

目标用户是在自己的代码库中运行编码智能体、同时需要可审计工具治理和客观验证的开发者。裸 LLM 能提出动作，却不能可靠负责文件边界、危险操作审批、测试反馈、跨会话记忆或凭据治理。本项目自行实现这些 Harness 机制；线上页面只解释机制，完整产品保持单用户、本地可信运行。

INVEST 用户故事：

1. 开发者可用 mock LLM 离线运行主循环，从而无需网络和 Key 即可验证 Harness。
2. Agent 只能读写签发的会话工作区，避免模型动作越过边界。
3. 危险工具执行前暂停并等待一次性批准，批准不能被另一动作复用。
4. 失败测试被结构化分类并回灌下一轮，使 Agent 依据客观反馈改变行动。
5. 记忆按项目隔离并按需检索，避免其他项目污染当前上下文。
6. 用户可临时或通过 OS 凭据库提供 Key，并可查看状态、更新和清除而不回显明文。
7. 用户可整组导出生成文件及摘要清单，使临时工作区回收后结果仍长期存在。
8. 用户在应用导出前可看到创建/替换预览，只批准与清单摘要绑定的一组变更。

## 9. 领域与机制设计

- **动作/工具**：`ToolRegistry` 提供文件、搜索、Shell、测试和 Git 工具；参数与风险级别声明在代码中，最终执行统一经过 Governance，路径固定在签发 workspace。
- **客观反馈**：`TestRunner`、`ResultParser`、`FailureClassifier` 和 `FeedbackLoop` 将测试结果转为结构化修正信息并加入下一轮，而非要求 LLM 自我评价。
- **危险动作/重点贡献**：治理是主角维度。危险动作进入 HITL；批准绑定 tool call ID、名称和规范化参数并单次消费；拒绝、取消和过期不会留下批准。项目变更批准同样绑定 manifest 摘要和目标集合。
- **记忆**：`sql.js` MemoryStore 按 projectPath 隔离约定、决策和知识，ContextBuilder 只检索相关条目。
- **可单测性**：移除真实 LLM 后，mock/stub 测试仍覆盖工具分发、治理、反馈回灌、记忆和停机；静态演示固定重放危险动作阻止与失败后行动变化。

## 10. 非功能需求与威胁模型

- **安全**：服务默认 loopback；静态/public 不接收 Key 或注册进程工具；秘密不进入日志、URL、历史或客户端持久状态；路径拒绝 traversal、`.git` 和符号链接。
- **可靠性**：导出核对大小与 SHA-256，staging 后 rename；manifest 或 artifact 改变会使批准失效。
- **性能**：单用户并发受限，接口限流；历史保存和中止有超时。
- **可用性**：凭据仅有“仅本次使用”和“记住在此设备”；keyring 不可用时提供明确降级说明。
- **可观测性**：SSE 输出结构化阶段事件，错误使用稳定且不含秘密的代码。
- **攻击边界**：防御远程请求、模型输出和无意路径错误；不宣称抵御同一 OS 账户下恶意进程主动竞态。

## 11. 架构、数据流与外部依赖

本地 React WebUI 调用 loopback Express；Server 组合 RuntimePolicy、SessionRegistry、AgentRun、CredentialStore 与 SSEManager；AgentLoop 通过 LLMAdapter 决策，经 ToolRegistry/Governance 执行动作，测试反馈与 MemoryStore 返回 ContextBuilder。静态演示使用独立 Vite 入口，依赖闭包不含 Server、凭据或进程工具。

外部依赖为 DeepSeek HTTPS API、操作系统凭据库及 Node.js 文件/进程接口；Express、React、Vite 分别承担 API、UI 和构建。不使用现成 Agent 编排框架。

## 12. 数据模型

- `Session`：ID、workspace、状态、消息、工具调用、反馈与时间。
- `MemoryEntry`：ID、projectPath、类型、内容、标签、时间；查询和删除按项目隔离。
- `ArtifactRecord`：relativePath、operation、size、sha256、timestamp、toolCallId。
- `ExportManifest`：sessionId 与 ArtifactRecord 集合；完成导出不可覆盖。
- `CredentialStatus`：storage 与 hasKey，不包含秘密。

## 13. 技术选型、UI 与分发

TypeScript 让 Core、Server、React 共享类型；Node.js 22 提供文件、子进程和 npm 分发生态；Vitest/Node test 支持确定性测试；DeepSeek 位于可替换的 `LLMAdapter` 后。

前端沿用已有轻量 CSS token 和 React 组件，没有引入 Open Design skill；这是收尾阶段避免大规模视觉重写的明确偏差。静态机制演示采用高对比时间线，并以脚本验证依赖边界。

分发选择 npm tarball/CLI，目标为 Node.js 22 支持的 Windows、macOS、Linux；原生 keyring 依赖平台凭据服务。GitHub Pages 只分发静态演示，不部署完整服务器。

## 14. 验收标准

- typecheck、全测试、build 和 package verifier 退出 0。
- mock LLM 确定性证明危险拦截、反馈导致行动变化及一次性批准。
- 静态 bundle 不含 Key、Express、child process、本地 API 或 keyring。
- 凭据支持 set/status/update/delete 且不回显；keyring 不可用时不生成替代文件。
- 产物导出到项目 `.harness/outputs/<session-id>/`，临时 workspace 清理后仍可读。
- 项目应用先预览；替换标危险；批准单次使用，内容改变后拒绝。
- clean pack/install 后 CLI 提供 loopback health/WebUI，终止后释放端口。

## 15. 风险与未决问题

- Linux 没有 Secret Service 时持久凭据不可用，只能使用临时 Key。
- 原生 keyring 需要受支持 OS/CPU；未承诺代码签名或单文件二进制。
- Pages URL、Release tag 与附件 URL 只有远端工作流实际成功后才能记录。
- `REFLECTION.md` 必须由学生本人修订至 1500–2500 字，并纠正历史部署说法。
