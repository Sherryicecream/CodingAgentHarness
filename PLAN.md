# Coding Agent Harness：实现计划、演进与最终交付状态

> 当前状态日期：2026-08-13。本文区分“2026-07-25 原始实现计划”“后续加固任务”和“尚未完成的外部交付门槛”。历史方案不再作为当前产品承诺。

## 1. 计划证据索引

- 原始 `writing-plans` 输出：[`docs/superpowers/plans/2026-07-25-original-implementation-plan.md`](docs/superpowers/plans/2026-07-25-original-implementation-plan.md)。该快照包含 9 个 Phase、62 个 task，以及每个 task 的目标、文件路径和验证步骤。
- 设计和计划演进：`docs/superpowers/specs/`、`docs/superpowers/plans/`。
- 逐日执行证据：`AGENT_LOG.md`。
- brainstorming、冷启动和方案取舍：`SPEC_PROCESS.md`。
- 当前产品契约：`SPEC.md`。若历史计划与当前契约冲突，以 `SPEC.md` 为准。

原始 62-task 计划没有在实现过程中逐项持续写回 commit hash；这是课程流程偏差，不能通过事后文档改写为已遵循。Git 历史、`AGENT_LOG.md` 和下方加固任务表共同提供可核验映射。

## 2. 原始 62-task 阶段映射

| Phase | Tasks | 目标 | 主要实现提交/阶段证据 | 当前结论 |
| --- | --- | --- | --- | --- |
| 1 | 1–5 | Monorepo、类型、测试、CI | `188482d` 后续实现提交；完整时间线见 `AGENT_LOG.md` | 完成 |
| 2 | 6–9 | LLM 抽象、Mock、DeepSeek、响应解析 | 7 月 25 日 Phase 1–2 提交组 | 完成 |
| 3 | 10–17 | 文件、Shell、测试、搜索和 Git 工具 | 7 月 25 日 Phase 3 提交组 | 完成 |
| 4 | 18–22 | Guardrail 与 HITL | 初始实现；加固 `8a5662c`–`6d33edf` | 完成并加固 |
| 5 | 23–32 | 反馈闭环与确定性演示 | 初始实现；加固 `c48746d`、`750d787` | 完成并加固 |
| 6 | 33–37 | 记忆、上下文、配置、停止条件 | 初始实现；加固 `7873131`、`2469f5b`、`a62658b` | 完成并加固 |
| 7 | 38–43 | AgentLoop、Session、Core 集成 | 7 月 25 日 Phase 7 提交组 | 完成 |
| 8 | 44–53 | Express、SSE、React WebUI | 7 月 25 日 Phase 8；后续安全与 UI 修复 | 完成 |
| 9 | 54–62 | CLI、部署、凭据、文档、冷启动、CI、分发 | 多次方案演进；见下方 Task 4–9 | 部分完成；冷启动晚于规定时点 |

原始计划中的早期托管、凭据文件、运行时与数据库驱动选择均已废弃，详情只在带历史警示的原始快照中保留。当前方案是 Node.js 22、`sql.js`、OS keyring、本地 loopback 完整版和线上无服务器静态演示。

## 3. 最终加固任务

状态定义：

- **完成**：实现、确定性测试和本地验证均存在。
- **部分完成**：代码已实现，但指定环境或外部交付证据尚未闭合。
- **待外部操作**：需要 GitHub 设置、Release 发布或学生本人完成，不能由本地测试替代。

| Task | 目标与准确文件 | RED/验收测试 | 依赖 | 关键提交 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | 危险工具风险进入 Governance/HITL；`packages/core/src/tools/tool.ts`、`guardrail/*`、`loop/agent-loop.ts` | `packages/core/test/guardrail/*.test.ts`、`loop/agent-loop.test.ts` | 原始 Tasks 10–20、38 | `8a5662c`, `4fbf033`, `5398188`, `bb426ea`, `6d33edf` | 完成 |
| 2 | MemoryStore 按项目隔离并注入 AgentLoop；`packages/core/src/memory/*`、`loop/context-builder.ts`、Server 生产装配 | `packages/core/test/memory/memory-store.test.ts`、`loop/context-builder.test.ts`、Server agent tests | Task 1；原始 Tasks 33–38 | `7873131`, `2469f5b`, `a62658b` | 完成 |
| 3 | 证明失败反馈改变下一轮 Mock 行动；`packages/core/src/feedback/*`、`llm/mock.ts`、demo | `packages/core/test/demo/feedback-demo.test.ts`、`loop/agent-loop.test.ts`、Server demo tests | Tasks 1–2 | `c48746d`, `750d787` | 完成 |
| 4 | npm tarball 与安装后 CLI 启动；三个 `package.json`、`packages/cli/src/cli.ts`、Server build | `packages/cli/test/installed-runtime.test.mjs`、`scripts/verify-packages.mjs` | Core/Server build | `1666103`, `993ee8f`；本轮 Windows 清理修复 | 完成：Windows 4/4，health/配置/WebUI/端口回收通过 |
| 5 | OS keyring、memory-only Key、配置状态和认证分类；`credential-keyring.ts`、`credential-store.ts`、`routes/config.ts`、`routes/test-key.ts`、`ConfigPage.tsx` | credential/config/test-key tests；401/402/429/5xx/连接失败分类 | Task 4、本地模式 | `e6796a3`, `badd838` | 完成 |
| 6 | 会话产物追踪、SHA-256 manifest、原子导出；`session/artifact-tracker.ts`、`artifact-exporter.ts`、`workspace-manager.ts` | artifact/workspace tests，拒绝穿越、链接、摘要变化和覆盖 | Server session、Task 1 | `e6796a3`, `dc7d52e` | 完成 |
| 7 | 项目变更预览、摘要绑定和单次批准；`session/project-change-applier.ts`、agent routes/UI | `project-change-applier.test.ts` 与 route/UI tests | Task 6 | `921ba04` | 完成 |
| 8 | 无 Key 静态机制演示和 Pages workflow；static Vite entry、`.github/workflows/ci.yml` | static build、`verify-static-boundary`、public demo tests | Task 3；发布依赖 unit-test | `921ba04`, `d578edc` | 完成：已记录成功 CI，Pages 根页面与 JS/CSS 均已实测 200 |
| 9 | AI4SE 文档、最终验证和分发；根目录交付文档、CI、package verifier | `test:docs`、`check:docs`、typecheck、test、build、package、audit | Tasks 1–8 | `874f29f`, `192294e`, `487e5ed`, `99d7906` | 完成：Reflection 正文合规，Pages 与 `v0.1.0` Release 均已公开验收 |

## 4. 依赖与可并行关系

```text
Tasks 1–3 Harness 内核
        ├── Task 5 本地凭据与 API
        ├── Task 6 产物追踪/导出 ── Task 7 项目应用
        └── Task 8 静态机制演示

Task 4 npm/CLI 分发依赖 Core + Server build
Task 9 最终交付依赖 Tasks 1–8 和外部 Pages/Release 状态
```

Tasks 1–3 的内部修复存在共享 Core 状态，按顺序完成；Task 5、Task 6 和 Task 8 可在独立 worktree 并行；Task 7 必须在 Task 6 后串行；Task 9 最后执行。

## 5. 当前验证证据

2026-08-13 最近一次本地审查：

- workspace typecheck：通过。
- Core：297/297。
- Server：197/197。
- 文档一致性：10/10。
- npm package entry、完整 build、静态 build/boundary：通过。
- API/凭据专项：10/10。
- 产物/工作区专项：47/47。
- public 安全演示专项：75/75。
- 生产依赖 audit：0 个已知漏洞。
- 实际本地 Server：health 200、WebUI 200；本机 OS keyring 状态为可用但未保存 Key。
- CLI Windows 自动生命周期：修复测试 fixture 精确 PID 清理后，当前 4/4 通过；packed CLI 验证 health、配置状态、WebUI 与端口回收。
- Release 文档更新前的 GitHub Actions CI #66（run `31708083604`）：`unit-test` 与 `deploy-static-demo` 均成功；后续文档提交的 CI 也按相同门槛独立核验。Pages 静态机制演示 `sherryicecream.github.io/CodingAgentHarness/` 的根页面、JavaScript 与 CSS 均实测 HTTP 200。真实可点击 URL 记录在 `AI4SE_DELIVERY_CHECKLIST.md`。
- GitHub Release `v0.1.0`（Release ID `369970882`）已公开：annotated tag 指向 `99d7906`，三个 tarball 与 `SHA256SUMS.txt` 均从公开下载路径实测 HTTP 200，文件大小和 SHA-256 与本地验证制品一致。

## 6. 最终复核命令

Release 与 Pages 外部门槛已经闭合；提交最终文档前执行：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run verify:packages
npm.cmd run build:static-demo
npm.cmd run verify:static-boundary
npm.cmd run check:docs
npm.cmd audit --omit=dev
```

## 7. 如实记录的流程偏差

- 陌生智能体冷启动在实现后补做，而课程要求在实现前完成。
- 初期开发主要在线性工作区进行，没有做到每个独立功能一个 worktree/PR；后期加固才规范使用。
- 原始 62-task PLAN 没有逐 task 持续写回 commit hash。
- 部分早期提交/PR 没有标注 subagent 与人工修改。
- 旧凭据文件和托管方案经过实现/评审后被废弃；其文档只作为过程证据保留。

这些偏差不能追溯修复为“完全遵循”，但已在 `SPEC_PROCESS.md`、`AGENT_LOG.md` 和 `REFLECTION.md` 中说明。
