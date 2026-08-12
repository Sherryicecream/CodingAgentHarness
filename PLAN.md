# Coding Agent Harness：最终交付加固计划与状态

> 基线：`origin/master` at `0fb39b8`。加固分支：`codex/final-delivery`。日期：2026-08-12。

## 状态定义

- **已闭合**：要求的实现、测试证据、审查修复与提交均存在。
- **部分闭合**：产品修复存在，但指定的端到端自动化证据仍有明确间隙。
- **本轮执行**：正在按本计划处理，不推导整个仓库或 release 的完成状态。

这份表是本轮唯一状态来源。旧计划中的阶段数量、历史测试总数和早期分发目标不再作为当前验收结论。

## 加固任务总表

| Task | 目标 | 提交 | 证据摘要 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | 危险工具风险进入 Governance/HITL | `8a5662c`, `4fbf033`, `5398188`, `bb426ea`, `6d33edf` | Core 292/292 与 build 通过；4 轮审查修复后无重要阻断 | 已闭合 |
| 2 | MemoryStore 项目隔离并注入 AgentLoop | `7873131`, `2469f5b`, `a62658b` | Core 295/295、memory 9/9、Server 集成与 build 通过 | 已闭合 |
| 3 | 证明反馈导致下一步 mock 行动改变 | `c48746d`, `750d787` | Core demo 6/6、Server demo 17/17、两个 build 通过 | 已闭合 |
| 4 | 修复安装包 metadata、Server 入口和 CLI 解析 | `1666103` | Core 297、Server 184、包 build 与 stale-chunk 1/1；人工 clean-install 成功；自动 Windows 清理证据有间隙 | 部分闭合 |
| 5 | 隔离本地凭据文件并验证完整生命周期 | `61bed5f` | focused lifecycle 1/1、Server 185/185、Server build 通过 | 已闭合 |
| 6 | 对齐五份交付文档并增加一致性扫描 | `874f29f` | scanner 10/10、五份文档扫描通过 | 已闭合 |
| 7 | CI 构建与 package entry 可复现验证 | `714b078` | CI contract 2/2、package verifier 3/3、build 通过；root test 超过 240 秒后终止 | 已闭合 |
| 8 | 最终验证、学生反思清单与发布边界 | 本提交（验证基线 `714b078`） | Core 297、Server 185、build、demo/mechanism、凭据与 package 检查通过；CLI clean-install 自动证据仍超时 | 部分闭合 |

## Task 1：危险工具治理

### 验收范围

- ToolRegistry 使用注册工具的 `riskLevel`，而不是只检查命令文本。
- `dangerous` 工具即使执行无害文本，也会进入 HITL。
- 批准绑定不可变的 tool call 名称、ID 与规范化参数，只消费一次。
- AgentLoop abort 后不能留下可复用批准或继续执行。

### 实际过程

初始提交 `8a5662c` 建立风险感知路径。独立审查连续发现 Registry 绕过、宽松批准布尔值、批准复用和 callback abort 竞态，分别由后续四个提交收紧。最终报告记录 Core 292/292 和 build 通过；可选的深层参数 mutation 用例未纳入本任务。

## Task 2：项目记忆隔离

### 验收范围

- MemoryStore 的搜索、写入和删除都需要项目身份。
- SQL 查询以 `project_path` 参数化过滤。
- AgentLoop 只把当前 `workingDir` 的受限结果交给 ContextBuilder。
- Server 生产调用路径注入真实 MemoryStore。

### 实际过程

`7873131` 引入项目隔离与 AgentLoop 记忆；审查发现 Server 生产调用者缺少依赖和删除边界不完整，由 `2469f5b` 与 `a62658b` 修复。任务报告同时记录 Server `tsc --noEmit` 存在与本任务无关的旧错误；这不被改写成全仓类型检查成功。

## Task 3：反馈因果性

### 验收范围

- MockLLMAdapter 能记录请求，并依据下一轮请求中可观察的反馈选择响应。
- selector 不读取私有 `feedbackState` 捷径。
- 第一次已知失败、结构化修复建议、不同的第二动作和第二次通过都有断言。
- public demo 的结构化 allowlist 不被破坏。

### 实际过程

`c48746d` 建立 selector 与反馈演示；审查要求第二轮动作必须依赖消息中真实反馈，`750d787` 加强该断言。最终 demo 测试计数为 Core 6/6、Server 17/17。

## Task 4：安装包与 CLI

### 验收范围

- Server package 导出稳定入口并包含 client 资产。
- CLI 通过 package metadata 解析 Server，不使用 monorepo 相对 fallback。
- Server build 清理旧 chunk，tarball manifest 不含 stale chunk。
- 安装后的命令默认监听 `127.0.0.1`。

### 实际过程与证据边界

`1666103` 包含产品修复和 package-manifest regression。自动 clean-install 测试在受限运行的安装阶段超时，任务报告没有宣称成功。

之后用户提供人工干净安装证据：安装新增 90 个包；CLI/Server/Client 入口存在；`/api/health` 返回 200 且 mode 为 local；`/` 返回 200；停止后无监听。该结果只证明一次人工路径成功，不能替代自动 Windows cleanup 测试。因此 Task 4 标记为**部分闭合**。

## Task 5：凭据生命周期隔离

### 验收范围

- `HARNESS_CREDENTIALS_FILE` 仅作为本地测试路径覆盖；空白或缺失时保持默认文件。
- 测试使用 fake sentinel、临时 home/workspace/session/memory/credential 位置和真实 loopback HTTP。
- 覆盖 initialize、status、update、lock、unlock、clear，且响应和加密文件不含明文。
- 子进程在 `finally` 停止，sandbox 在测试后清理。

### 实际过程

`61bed5f` 添加环境 seam 和集成测试。报告保存了生产修改前的行为 RED、最小修改后的独立 GREEN、测试 launcher refactor 后 GREEN、Server 185/185 与 build 结果。端口预留存在轻微 TOCTOU 风险，空白包围的相对路径缺少直接集成覆盖；两者作为非阻断关注项保留。

## Task 6：文档契约

### 验收范围

- scanner 只读取五份目标文档，使用 Node built-ins，对受控 stale/clean 文档断言退出码与诊断。
- README 清楚区分本地完整交付与公开确定性演示，写明 CLI/WebUI、release tarball 获取、凭据、Windows 限制和 Task 4 证据边界。
- SPEC 使用 `sql.js`，定义模块 I/O/边界/错误，并记录 `HARNESS_CREDENTIALS_FILE` 的测试覆盖性质。
- PLAN 保持一张无冲突状态表，使用真实 Task 1–5 commits 和结果。
- SPEC_PROCESS 只记录可从 briefs、reports 和 Git 历史确认的过程，不重演无法核验的历史。
- AGENT_LOG 记录 Task 1–5 的任务、技能/上下文、执行角色证据、提交、人工干预与教训。
- `REFLECTION.md` 不修改。

## 最终门槛

1. `npm.cmd run test:docs`
2. `npm.cmd run check:docs`
3. 对五份文档逐段人工检查运行模式、凭据、分发、Task 4 与 Task 1–5 commits。
4. 运行与文档/脚本风险相称的现有测试或 build；若工作区中有他人修改，不能把结果归因给本提交。
5. 暂存时只选择五份文档、scanner、scanner 测试和根 package script。
6. `git diff --staged --check`，审查秘密词命中上下文，并确认 `REFLECTION.md` 无差异。
7. 原子提交信息：`docs: align final local delivery contract`。

## 明确保留的关注项

- Task 4 的自动 Windows clean-install/cleanup 成功证据尚未闭合。
- 2026-08-12 最终复验中，完整 CLI suite 在无输出状态下超过 240 秒并被终止；仅两个非安装 CLI 检查 2/2 通过，不能推出 clean-install/start/cleanup 自动验证成功。
- Task 5 测试的端口预留竞态和路径空白直接覆盖可后续加强。
- 任务报告记录的旧 Server 独立 `tsc --noEmit` 错误不属于本轮文档修改；不能宣称全仓类型检查通过。
- `REFLECTION.md` 只读复核发现 2,696 个汉字，超过 2,500 上限，且含未核验部署/历史数字和文字问题；只有学生本人可按忽略目录中的 checklist 修改正文。
- `submission.jsonc` 保持只读；其 `is_deployed: true` 和公网地址未在本轮访问或核验，也未改成 Release URL。
- Release 附件的最终 URL、tag 和文件名只有实际发布后才能记录；本计划不执行发布、推送或外部操作。
