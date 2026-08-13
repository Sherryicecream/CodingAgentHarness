# AGENT_LOG：AI 协作开发时间线

## 记录规则

本日志覆盖 2026-07-25 至 2026-08-13 的关键实现节点，对应 AI4SE §4.9。早期阶段按功能归组，8 月 12–13 日保留更细任务记录。每项尽可能给出 task/阶段、技能或协作方式、context、commit、人工干预和教训。

证据标签：**Git** 表示可由提交确认；**历史日志**表示内容来自当时已提交日志但原始会话不在仓库；**当前复核**表示 8 月 12–13 日由 briefs/reports、测试或本地预览再次确认。测试数只代表对应日期的快照。

## 2026-07-25 — 立项、SPEC 与 PLAN

- **Tasks**：问题定义、架构选型、62-task 实现计划。
- **Skills/context**：历史日志记录使用 brainstorming、writing-plans；目标是自建 Harness 内核、Mock LLM 测试和 WebUI。
- **关键输出（Git）**：`bb4839d` 初始 SPEC；`70ffe41`、`87c091e` 两轮架构调整；`188482d` 完成 PLAN。
- **人工决策**：TypeScript 严格模式、npm workspaces、Vitest；反馈闭环为主角机制；Express + React Web-first；CLI 为薄启动器。
- **方法偏差**：没有在实现前完成课程要求的陌生智能体冷启动。
- **教训**：先写 SPEC/PLAN 能形成提交边界，但详细 task 不自动保证陌生执行者能理解依赖。

## 2026-07-25 — Phase 1–2：Monorepo 与 LLM 抽象

- **Tasks**：1–9。
- **协作方式**：历史日志记录为 subagent-driven-development；仓库未保存 agent 名称和原始 prompt。
- **输出（Git）**：`efded2f` 至 `b3e4aba`，建立 Core/Server/CLI、类型、CI、LLMAdapter、MockLLMAdapter、DeepSeekAdapter 和 ResponseParser。
- **Context**：Mock 响应 FIFO 用于确定性测试；真实适配器与核心循环通过接口解耦。
- **人工干预**：选择 OpenAI-compatible DeepSeek 接口，同时要求核心测试不调用真实 API。
- **教训**：纯类型接口需要 `tsc` 验证，不能只依赖运行时测试；这一缺陷后来由冷启动发现。

## 2026-07-25 — Phase 3–4：工具与治理

- **Tasks**：10–22。
- **输出（Git）**：`8032083` 至 `cf1f291`，实现 ToolRegistry、文件/Shell/测试/Git 工具、Guardrail、HITLManager 和 GovernanceService。
- **Context**：工具携带风险等级，命令内容再接受护栏检查。
- **人工决策**：危险操作必须进入 HITL；文件工具限制路径穿越和 `.git`。
- **后续缺陷**：风险元数据最初未完全进入最终 dispatch，批准也可能过宽或复用，8 月 12 日集中修复。
- **教训**：预检查安全不等于执行边界安全。

## 2026-07-25 — Phase 5：反馈闭环

- **Tasks**：23–32。
- **输出（Git）**：`aee5335` 至 `dba0ce3`，实现 TestRunner、解析器、分类器、FixSuggestionBuilder、FeedbackLoop 和 demo。
- **Context**：Harness 只提供结构化失败上下文，LLM 生成修复动作；支持 Jest/Vitest parser。
- **人工决策**：拒绝让 Harness 自身生成补丁，以保持机制确定性和可测试性。
- **教训**：预排两条 mock 响应只能证明顺序，不能证明反馈导致第二动作改变；8 月 12 日补了因果测试。

## 2026-07-25 — Phase 6–7：记忆、配置与 AgentLoop

- **Tasks**：33–43。
- **输出（Git）**：`073c905`、`d9790e8`，实现 `sql.js` MemoryStore、ContextBuilder、ConfigLoader、StopCondition、AgentLoop 和 SessionStore。
- **Context**：选择 WASM SQLite 避免 Windows 原生编译；AgentLoop 保持薄编排，能力经接口注入。
- **人工决策**：记忆按 `project_path` 组织，配置采用默认值与用户覆盖。
- **后续缺陷**：项目字段存在不代表搜索/删除/生产注入都隔离；8 月 12 日补齐全链路项目身份。
- **教训**：数据隔离是调用链属性，不只是 schema 属性。

## 2026-07-25 — Phase 8–9：Server、React WebUI、CLI 与文档

- **Tasks**：44–62。
- **输出（Git）**：`d05e21f`、`5844d59`、`ddacaa6`，实现 Express API、SSE、React 组件、CLI、README、首版 SPEC_PROCESS/AGENT_LOG。
- **Context**：SSE 推送执行事件，REST 发送控制请求；不引入 React Router。
- **人工决策**：WebUI 用于时间线和 HITL 可视化，CLI 只负责启动本地服务并打开浏览器。
- **方法偏差**：这些阶段直接在 `master` 线性开发，没有逐功能 worktree/PR。
- **教训**：真实分发不能依赖 monorepo 相对路径；后来必须用 packed CLI 验证。

## 2026-08-03 — 冷启动补做、UI 与凭据/分发收尾

- **Tasks**：陌生 agent 尝试 Tasks 6–7；Open Design UI；凭据和 Docker 分发。
- **Skills/context**：冷启动使用不同 agent 的全新上下文，只提供当时 SPEC/PLAN；但发生在主体实现之后。
- **输出（Git）**：`3ae72d3` UI design；`be10126` 修复冷启动发现；`47edb81` 记录结果；`c4c36ec` 凭据/容器/文档；`1be4bab` 中文 UI。
- **Agent 暂停/输出摘要（历史日志）**：发现脚手架假设、LLMAdapter 双权威位置、Vitest 无法验证纯类型、Mock error/数组所有权不明、依赖过晚和部署描述冲突。
- **人工干预**：修订 SPEC/PLAN；将早期凭据改为 AES-256-GCM 加密文件；增加 ConfigPage；部署叙述从托管平台转向国内云主机容器方案（两者均为历史设计）。
- **偏差**：冷启动补做有价值，但不满足“实现前验证”；历史日志中的外部部署结果当前未重新核验。
- **教训**：让陌生 agent 真正实现，比仅让它评论文档更容易发现规约缺陷。

## 2026-08-07 — 反思、审查与回溯 PR

- **Tasks**：反思报告、严重/重要问题审查、Git 流程补救。
- **输出（Git）**：`1162ace` Reflection；`20817a5`、`4ab2b9d` 修复审查问题；`c301890` 记录回溯 PR。
- **人工干预**：修复 AgentLoop 状态、Docker healthcheck、Guardrail 正则和类型逃逸；为 Phase 1–9 从历史提交创建回溯分支/PR。
- **方法偏差**：回溯 cherry-pick 改变 commit 身份，只能用于展示分阶段差异，不能证明原开发使用了 worktree/PR。
- **教训**：Git 工作流证据必须在开发当时形成，无法在收尾阶段完整追建。

## 2026-08-08 — 凭据泄漏修复与公开 API 安全

- **Tasks**：credential leak remediation；public API security Tasks 1–8。
- **Skills/context**：brainstorming、writing-plans、worktree、TDD、subagent-driven-development、requesting-code-review、verification-before-completion；分支 `codex/public-api-security`。
- **输出（Git）**：`0fb8d37`/`89bb33f` 设计计划；`b019157`/`d2e09f6` public security 设计计划；`c35d31c` 至 `87ec31a` 实现 app factory、RuntimePolicy、Server-owned workspace/session、瞬时 BYOK、deterministic demo 和 UI。
- **Review 修复**：`91799d7` 至 `bbd4078` 处理 cleanup、session race、BYOK 生命周期；`aef4b95` 至 `2a924cd` 处理 demo capability/write race。
- **人工决策**：public 不注册 Shell/Git/进程工具，不保存 Key；local 保留完整能力；服务端 capability 而非 UI 隐藏决定权限。
- **教训**：安全关键异步流程需要所有权、generation/abort 和终态串行化，单一 mounted flag 不够。

## 2026-08-09 — 公开/本地体验边界与主密码方案

- **Tasks**：本地/公网体验设计；master-password credential lifecycle。
- **输出（Git）**：`a6225d0`、`c6f2b36` 体验设计/计划；`d677125` 至 `f36b50a` 实现；`d101353`、`21ccdb9` 主密码设计/计划；`912c422` 至 `5858f19` 凭据生命周期。
- **Context**：公网展示 demo，真实 API 只在本地；主密码方案使用 scrypt + AES-256-GCM 文件并显式 lock/unlock。
- **人工干预**：HTTP BYOK 只在明确配置/loopback 边界内允许；公开历史在浏览器本地保留而服务端不持久化。
- **后续修正**：用户认为主密码和 Provider 配置冗余、逻辑不清，8 月 13 日最终改为 OS keyring。
- **教训**：密码学上成立的方案仍可能在产品生命周期和可解释性上失败。

## 2026-08-12 — Final-delivery hardening：设计与执行

- **Worktree/branch**：`.worktrees/final-delivery`；`codex/final-delivery`；基线 `0fb39b8`。
- **Skills/context**：brainstorming、writing-plans、using-git-worktrees、subagent-driven-development、TDD、两阶段 review、verification-before-completion。
- **设计/计划（Git）**：`72993d7`、`153b8f7`。

### Task 1：危险工具治理

- **Commits**：`8a5662c`、`4fbf033`、`5398188`、`bb426ea`、`6d33edf`。
- **Review**：四轮修复 Registry 绕过、批准匹配过宽、批准复用和 abort 竞态。
- **人工干预**：要求继续修复 critical 问题并保持 scope；PowerShell 改用 `npm.cmd`。
- **教训**：批准必须绑定不可变动作、一次消费并在 abort 时清除。

### Task 2：项目记忆隔离

- **Commits**：`7873131`、`2469f5b`、`a62658b`。
- **Review**：补 Server production store 注入和项目隔离删除。
- **教训**：搜索、写入、删除、retrieval 和 composition root 必须使用同一项目身份。

### Task 3：反馈驱动修正

- **Commits**：`c48746d`、`750d787`。
- **Review**：selector 必须观察实际发给 LLM 的消息，缺少反馈时不能产生修正响应。
- **教训**：先后顺序不等于因果。

### Task 4：安装包与 CLI runtime

- **Commit**：`1666103`。
- **结果**：通过 package exports 解析 Server，并清理 stale chunks；早期完整安装测试曾超时，人工 clean install 与自动验收分开记录。
- **教训**：manifest 正确不能推出安装后生命周期正确。

### Task 5：隔离凭据测试

- **Commit**：`61bed5f`。
- **Context**：当时仍针对加密文件 seam；禁止读取真实用户凭据路径。
- **后续状态**：该生产方案 8 月 13 日被 OS keyring 取代，测试改用 fake keyring/禁用 keyring。

### Tasks 6–8：文档、CI/package 与验收

- **Commits**：`874f29f`、`714b078`、`b0b29d7`、`5faeb2f`。
- **输出**：文档 consistency scanner、CI contract、package verifier、全量验收报告。
- **人工干预**：禁止把人工成功写成自动成功，不修改学生 Reflection。
- **集成偏差**：finishing 技能后学生选择本地 merge，`ebc225f` 合入 `master`，本轮未建新 PR。
- **教训**：所有完成声明必须绑定命令、日期和 commit。

## 2026-08-13 — Windows CLI 生命周期与配置/文件保存

- **Tasks**：packed CLI cleanup；Provider 配置；长期文件保存。
- **输出（Git）**：`6c38022`、`93d3891`；`0fd978a` 至 `a435a4e`；`c1077a3`、`deec9b3`、`30bbd9b`。
- **Context**：先后尝试 Provider/加密配置 UI，再根据用户反馈简化为 DeepSeek 线性配置；workspace 增加显式 preserve/save。
- **人工干预**：用户指出主密码逻辑冗余、测试连接失败信息不清、生成文件不能长期保存。
- **教训**：临时 workspace 适合隔离执行，长期文件必须由用户显式保存到项目输出目录；连接错误必须可行动。

## 2026-08-13 — Local-first final delivery

- **设计/计划（Git）**：`8e4cb9f`、`fdcc5c4`。
- **用户决策**：不部署服务器；本地完整 WebUI，线上纯静态机制演示。
- **实现（Git）**：`993ee8f` 恢复基线；`e6796a3` 完成本地优先交付；`921ba04` 安全应用导出；`192294e` 文档；`ebc225f` 合并。
- **当前凭据边界**：OS keyring 持久化；临时 Key memory-only；无 keyring 时显式不可持久化。
- **当前文件边界**：隔离 workspace 是临时区；保存/导出复制普通文件并验证 manifest/SHA-256 至项目 `.harness/outputs/<session-id>/`。
- **教训**：公开可访问不等于公开完整能力；“不部署服务器”也能通过静态机制演示满足 WebUI 展示目标，但需与本地产品清晰区分。

## 2026-08-13 — 本地预览反馈与缺陷修复

- **问题**：产物未登记、项目根解析错误、完成会话过早清理、连接错误诊断不清。
- **Commits**：`badd838`、`343fe78`、`bf4693e`、`dc7d52e`。
- **人工干预**：用户在真实 WebUI 复现“产物导出失败”和“测试连接失败”，并提供隔离工作区路径。
- **修正**：推荐演示文件进入 ArtifactTracker；导出相对调用项目根；completed/failed session 保留至 `expiresAt`；DeepSeek `/models` 测试区分认证、计费、限流、上游和网络错误。
- **教训**：工具写文件不等于产物已登记；完成状态不等于立即可回收；本地预览是单元测试之外必要的入口验证。

## 2026-08-13 — AI4SE 文档复核、干净 CI 与 Pages

- **文档提交**：`8f0a4fa`，统一 README/SPEC/PLAN/过程文档并新增交付与 Reflection 指南。
- **干净 CI 缺陷**：本地旧 `server/dist` 掩盖 CLI 类型依赖，GitHub runner 报找不到 `@harness/server`；`13236a3` 修复。
- **Pages 分支条件缺陷**：workflow trigger 接受 `master`，deploy condition 只允许 `main`；`bf88990` 修正并加 contract test。
- **验证边界**：公开 CI badge 为 passing；Pages URL 是否可访问仍取决于仓库 Pages 外部开关，不能由代码单独保证。
- **教训**：本地构建缓存会制造假绿；CI 分支触发与 job 条件必须成对检查。

## 2026-08-13 — Windows packed CLI、Pages 根入口与 v0.1.0 Release

- **Windows CLI 复现**：用户普通 PowerShell 首次报告 cleanup 与 packed runtime 两项失败；`3ceb545` 修复 detached fixture 精确 PID 清理。随后 packed install 连续两次在 50/60 秒边界超时，分阶段对照显示空 npm cache 安装用时 17.9 秒、默认 cache 3.5 秒；`3f60374` 保留全新安装目录但复用 npm 完整性校验 cache，focused、CLI 4/4 与全仓测试恢复 GREEN。
- **Pages 根入口**：CI #64 虽成功部署，但根路径 404、`static-demo.html` 为 200。`d578edc` 通过 Vite/Rolldown post bundle hook 只修改 HTML asset 的 `fileName`，并让 boundary verifier 强制检查 `index.html`、旧入口和相对资源。CI #65 与 #66 均成功，根页面、JavaScript 和 CSS 均实测 200。
- **过程方法**：Pages 修复先观察 verifier RED；两次未成功 GREEN 分别暴露 Vite HTML hook 顺序和 Rolldown 禁止重写 bundle 键，最终采用只修改已有 asset 的最小实现。设计、计划、TDD 证据和五轴 review 分别记录在 `docs/superpowers/`。
- **Release**：annotated tag `v0.1.0` 指向 `99d7906`；Release ID `369970882`。三个确切 tarball 在全新临时目录安装，Core/Server import、CLI health/WebUI/端口回收通过；SHA-256 复算一致且未发现真实 Key、私钥、本机路径或会话数据。
- **发布控制**：先创建 Draft，再上传并核对四个附件名称、状态和大小，集合完整后才公开。首次查询因预期 404 安全停止；第二次因 PowerShell 扩展字符串属性导致 GitHub 422，在 Draft 创建前停止；改用纯 .NET 字符串后成功公开。Release 页面和四个无需认证的下载地址均返回 200。
- **人工批准**：用户逐步批准 CLI 调查与修复、Pages 设计/执行/提交/推送，以及 Release 准备和正式发布；没有自动扩大远端写操作范围。
- **教训**：workflow 成功不等于入口可访问；Release 成功不等于附件完整。必须分别验证部署根路径、资源 URL、tag 指向、Draft 附件集合和公开下载结果。

## 2026-08-13 — 最终提交包的 Node 22 用户路径复核

- **用户目标**：不是让测试形式通过，而是保证其他人按 README 能正常使用。
- **设计/计划（Git）**：`f5e8298`；生产修复分别为 `f350aa2`（Windows Shell 进程树）、`8be1a6d`（HTTP listener 就绪）和 `ddc9537`（独立审阅加固）。
- **RED 证据**：官方校验的 Node.js 22.23.2 全新副本中，`execute_shell` 超时返回后立即删除 cwd 稳定报 `EBUSY`；`startServer()` 在监听回调前已解析，并把模拟 `EADDRINUSE` 错误误判为成功。
- **审阅加固**：独立审阅指出 `taskkill` 非零退出被忽略、裸可执行文件搜索、同步 `listen()` 异常未清理，以及旧 Release/新源码证据混写。随后固定 `%SystemRoot%\System32\taskkill.exe`、校验 SystemRoot 与退出码，并覆盖同步/异步绑定错误的 `app.close()`。
- **GREEN 证据**：Shell focused 7/7、Windows 清理 helper 3/3、Core 300/300；Server focused 7/7、完整 199/199；packed CLI focused 26.6 秒、完整 CLI 4/4；没有放宽测试预算或删除断言。
- **实际运行**：隐藏后台启动本地 Server，health 返回 `ok/local`，禁用 keyring 时配置返回 `unavailable/false`，WebUI 返回 200；停止后连续三次连接失败，证明端口释放。
- **交付元数据**：学号 `251250277` 的 `submission.jsonc` 保存在忽略目录，与源码 ZIP 并列，不进入 Git 或压缩包。
- **教训**：`listen()` 被调用不等于服务已就绪；杀死 Windows 命令 shell 不等于后代进程已退出。面向用户的验收必须覆盖 ready、error、timeout 和 shutdown 四个边界。

## 全流程方法偏差汇总

1. 冷启动在主体实现后补做，而非实现前。
2. 7 月 25 日初期阶段未使用逐功能 worktree/PR；8 月 7 日回溯 PR不能替代真实过程。
3. final-delivery worktree 最终按学生选择本地 merge，未创建对应 PR。
4. 凭据与交付方案多次改变；旧日志中的机器派生加密、主密码文件和云主机运行方案均不是当前实现。
5. 部分早期记录缺少原始 prompt、agent 身份和外部结果；本文只保留摘要并明确证据等级。

## 当前权威状态

- 完整 Harness 仅在 loopback 本地运行；线上构建为无秘密、无真实 LLM、无进程工具的静态演示。
- 持久凭据使用 OS keyring；临时 Key 仅在内存。
- 长期文件保存到项目 `.harness/outputs/`；`.harness-workspaces` 是隔离临时区。
- 当前验证基线记录为 Core 32 files/300 tests、Server 23 files/199 tests、CLI lifecycle 4/4；这些数字必须与对应 commit/运行日期一起解释。
- `REFLECTION.md` 属于学生本人材料，本轮没有代写或修改。
- GitHub Pages 静态演示与 `v0.1.0` Release 已公开验收；真实链接集中记录在 `AI4SE_DELIVERY_CHECKLIST.md`。
