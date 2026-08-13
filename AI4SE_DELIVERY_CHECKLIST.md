# AI4SE 最终交付核对表

核对依据：`AI4SE 期末项目 · 通用要求.md` + `AI4SE_Final_Project_A_Coding_Agent_Harness.md`。本表记录当前仓库证据，不替代课程原文。

## 必做工程要求

| 要求 | 仓库证据 | 验证 | 状态 |
| --- | --- | --- | --- |
| 自研 Agent 主循环 | `packages/core/src/loop/agent-loop.ts` | Core mock tests | 完成 |
| 可注入 LLM 抽象与 Mock | `packages/core/src/llm/` | Mock/loop tests | 完成 |
| 工具分发 | `packages/core/src/tools/` | ToolRegistry tests | 完成 |
| 危险动作代码护栏与 HITL | `packages/core/src/guardrail/` | governance tests | 完成 |
| 客观反馈闭环 | `packages/core/src/feedback/` | deterministic feedback demo | 完成 |
| 项目隔离记忆 | `packages/core/src/memory/` | memory tests | 完成 |
| 声明式配置 | `packages/core/src/config/` | config tests | 完成 |
| 凭据安全存储 | `credential-keyring.ts` + memory-only BYOK | Server tests；状态不回显 | 完成 |
| 首次录入/状态/更新/清除 | 本地 ConfigPage + config routes | credential/route tests | 完成 |
| 分发 | Core/Server/CLI npm tarball | `npm run verify:packages` + CLI 4/4 | 完成 |
| 本地完整 WebUI | loopback Express + React | clean installed CLI lifecycle | 完成 |
| 线上 WebUI | serverless static mechanism demo | static build/boundary | 代码完成，待远端 Pages 成功 |
| Mock 机制演示 | Core/Server demo + static timeline | deterministic tests | 完成 |

## 课程文档

| 交付物 | 覆盖内容 | 状态 |
| --- | --- | --- |
| `SPEC.md` | 问题、8 个 INVEST 故事、模块契约、NFR、威胁模型、架构、数据模型、领域机制、选型、分发、验收、风险 | 完成 |
| `PLAN.md` | task、依赖、并行关系、TDD/验证、提交与当前状态 | 完成；历史表明确标注 |
| `SPEC_PROCESS.md` | brainstorming、关键迭代、冷启动与偏差 | 完成 |
| `AGENT_LOG.md` | 技能、任务、提交、人工干预、验证与教训 | 完成 |
| `README.md` | 简介、安装、运行、分发、目录、安全、凭据、导出、限制 | 完成 |
| `.gitlab-ci.yml` | 名为 `unit-test` 的 job | 完成 |
| `.github/workflows/ci.yml` | push 测试、构建、package、docs、static Pages | 完成 |
| `REFLECTION.md` | 1500–2500 字，学生本人撰写 | **待学生修订** |

## 当前一键验证

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run verify:packages
npm.cmd run build:static-demo
npm.cmd run verify:static-boundary
npm.cmd run check:docs
npm.cmd audit --omit=dev
```

当前本地证据：Core 297/297、Server 197/197、CLI 4/4，生产依赖审计 0 个已知漏洞。

## 上传后必须核验

- GitHub/GitLab 最后一次 `unit-test`/CI 为 pass。
- GitHub Pages workflow 成功，并记录真实可访问 URL；不要预先填写猜测地址。
- 若课程平台以 NJU Git 仓库为唯一提交入口，应确认 GitHub 与课程仓库的最终 commit 一致。
- 不上传 `.harness/`、临时 workspace、真实 Key、日志或生成的示例文件。

