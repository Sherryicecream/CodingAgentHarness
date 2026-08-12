# Agent 日志

> 本日志保留 2026-08-12 final-delivery hardening 中可由 briefs、reports 和 Git commits 核验的记录。没有原始证据的 prompt 原文、外部操作或角色名称不作补写。

## 记录字段

每项包含：日期、任务、使用的过程技能/上下文、执行或审查角色证据、提交、人工干预和教训。这里的“独立审查”只表示任务报告明确记录的 reviewer 反馈；报告没有保存 subagent 名称时，不猜测名称。

## 2026-08-12 — Task 1：危险工具风险治理

- **任务**：让 registered tool 的 `riskLevel: dangerous` 在最终执行边界触发 Governance/HITL，即使命令文本无害。
- **过程技能/上下文**：task brief 要求严格 TDD、focused Core tests、full Core suite 和 risk-aware dispatch；reports 保存了 RED/GREEN 与四轮 review fix。
- **执行/审查角色证据**：实现代理完成初始测试与代码；独立 reviewer 连续指出 Registry 可绕过、批准布尔值过宽、批准可复用和 callback abort 竞态。报告没有保存代理名称或原始完整 prompt。
- **提交**：`8a5662c`, `4fbf033`, `5398188`, `bb426ea`, `6d33edf`。
- **人工干预**：协调要求每轮审查问题继续修复，并保留 scope；Windows PowerShell 的 `npm.ps1` 被策略阻止后，命令改用 `npm.cmd`。
- **结果**：Core 292/292 和 build 通过；审查清洁。深层/数组/键序 mutation 与直接 authorize spy 被记录为可选增强。
- **教训**：危险元数据只有到达最终 dispatch 才有安全意义；批准必须精确绑定动作、一次性消费，并在 abort 时清除。

## 2026-08-12 — Task 2：项目记忆隔离

- **任务**：MemoryStore 的 search/write/delete 使用显式 project identity，AgentLoop 只获取当前项目的 bounded memories，Server 注入生产 store。
- **过程技能/上下文**：task brief 指定同关键词跨项目 RED、AgentLoop/context RED、SQL 过滤、依赖注入、focused/full tests。
- **执行/审查角色证据**：实现代理完成初始隔离；独立 reviewer 发现 Server production caller 缺少 MemoryStore，并要求删除路径也按项目隔离。未保存 subagent 名称。
- **提交**：`7873131`, `2469f5b`, `a62658b`。
- **人工干预**：审查发现超出原始文件清单但属于真实 production seam 的 Server caller，协调接受该最小扩展；独立 Server typecheck 的旧错误被明确记录而未顺手修改。
- **结果**：Core 295/295、memory 9/9、Server focused integration 和 Server build 通过。
- **教训**：项目隔离必须贯穿数据库查询、删除、循环上下文和生产 composition root；只在 schema 中保存 project path 不够。

## 2026-08-12 — Task 3：反馈驱动行动修正

- **任务**：证明结构化测试反馈实际改变下一次 MockLLMAdapter 行动，不接受无条件 FIFO 排队作为因果证据。
- **过程技能/上下文**：brief 要求 real AgentLoop、known failing test、actionable fix、selector 和 public demo allowlist 保持不变。
- **执行/审查角色证据**：实现代理增加 request-recording selector 与反馈消息；独立 reviewer 要求 selector 必须观察发送给 LLM 的 message，而不能依赖私有 feedback state 或预置顺序。角色名称未记录。
- **提交**：`c48746d`, `750d787`。
- **人工干预**：审查后增加“反馈消息缺失就不能给出修正响应”的回归测试，没有扩展 public demo 输入面。
- **结果**：Core demos 6/6、Server demos 17/17，Core/Server builds 通过。
- **教训**：顺序相关不等于反馈因果；测试要让第二行动对可观察反馈条件敏感。

## 2026-08-12 — Task 4：安装包与 CLI runtime

- **任务**：为 Server/CLI 包建立稳定安装入口，去除 monorepo 相对解析，并避免 stale server chunk 进入 tarball。
- **过程技能/上下文**：brief 原本要求 pack、fresh install、运行 `harness`、health/WebUI 和 cleanup 的自动端到端验证；任务执行遵循先 manifest regression RED 再产品修复。
- **执行/审查角色证据**：实现代理完成 package metadata、CLI resolution 和 clean build。报告没有记录独立 reviewer 的名称。
- **提交**：`1666103`。
- **人工干预**：自动完整安装运行在 package-install 阶段超时后，协调禁止继续网络安装；后来用户提供一次人工 clean-install 证据：新增 90 个包，CLI/Server/Client 入口存在，health 200/local，首页 200，停止后无监听。
- **结果**：stale-chunk manifest 1/1、Core 297、Server 184 和三个 package build 通过。人工安装成功与自动 Windows cleanup 未核验被分别记录。
- **教训**：package manifest 通过不能自动推出安装后 lifecycle 通过；人工验证不能改写成自动化证据。

## 2026-08-12 — Task 5：隔离凭据生命周期

- **任务**：增加 `HARNESS_CREDENTIALS_FILE` 本地测试 seam，并通过真实 loopback HTTP 验证 fake credential 的 initialize/update/lock/unlock/clear。
- **过程技能/上下文**：协调将原 tarball verifier 范围收窄为本地 Server credential lifecycle，要求默认路径不变、所有可写位置沙箱化、响应/加密文件无明文、进程可靠停止。
- **执行/审查角色证据**：实现代理先遇到 Windows `os.userInfo()`/launcher 环境错误；该错误未被冒充为产品 RED。修正 test harness 后得到 seam-specific RED。reviewer 要求提供最小 production change 之后、launcher refactor 之前的独立 GREEN。
- **提交**：`61bed5f`（其前置安装解析提交为 `1666103`）。
- **人工干预**：协调明确不能读取真实 `~/.harness/credentials.enc`，也不能再做完整 tarball 网络安装；review fix 只根据原始命令结果补齐 report，没有制造新 code diff。
- **结果**：focused lifecycle 1/1、Server 185/185、Server build 通过；真实用户凭据路径未读取或修改。
- **教训**：环境启动失败不是目标行为 RED；安全测试先证明 sandbox home，再 import Server。测试 seam 应显式覆盖而保持生产默认不变。

## 2026-08-12 — Task 6：文档一致性

- **任务**：对齐 README、SPEC、PLAN、SPEC_PROCESS、AGENT_LOG，并加入只扫描这五份文件的 Node consistency checker。
- **过程技能/上下文**：严格 TDD、Git workflow、verification-before-completion；先读取 branch 与 `origin/master` 实际文件。两者在五份文档上无差异。
- **执行/审查角色证据**：当前实现代理先写 controlled-fixture test；scanner 不存在时测试 RED。实现 scanner 后的早期 checkpoint 为 fixtures 2/2 GREEN，未改文档的真实扫描产生 38 项 claim-level RED；随后审查推动独立 `PUBLIC_FULL_PRODUCT` 与逐类 fixtures，当前 suite 为 10/10。最终提交在 Git 写入后记录，不预先编造。
- **人工干预**：明确要求保留 Task 4 人工成功与自动化间隙的区别，不改 `REFLECTION.md`，不触碰共享 worktree 中既有 CLI test 修改和 artifacts。
- **教训**：文档测试必须执行 scanner 并断言行为，不能只 grep scanner 源码；PowerShell 默认解码造成的显示乱码应与实际 UTF-8 字节损坏区分。

## 当前证据边界

- 本日志不声明 npm 发布、release 上传、push、PR、外部部署或真实凭据操作。
- 每个测试计数绑定到对应任务报告，而不是当前全仓永久总数。
- 早期项目阶段和所谓冷启动的详细叙述没有在本轮重新验证；请把它们视为历史材料，而非本加固周期的验收证据。
