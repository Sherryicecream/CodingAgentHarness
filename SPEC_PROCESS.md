# SPEC_PROCESS：规约形成与偏差记录

## 证据范围

本文只叙述可从当前 Git 历史、`docs/superpowers/` 计划以及 `.superpowers/sdd/2026-08-12-final-delivery-hardening/` briefs/reports 交叉确认的过程。早期文档曾包含冷启动、外部发布、回溯分支和 PR 等详细故事，但当前仓库不足以独立核验其会话输入、耗时或外部结果；这些故事不作为本轮事实证据。

## 从需求到加固规约

2026-08-12，先以 `72993d7` 写入最终本地交付设计，再以 `153b8f7` 写入实施计划。设计把交付契约收窄为：

- 完整能力在 localhost 的 `local` 模式运行。
- `public` 只做确定性安全演示，不接触凭据和进程工具。
- 三个 workspace 包通过 release tarball 交付；没有发布就不写最终地址。
- 五个实现加固任务先完成，最后统一修正文档。

这次先写 design/plan、再执行 tasks 的顺序可由提交历史确认。它不证明更早的项目阶段也使用了同样流程。

## 实际执行方式

### 工作区

本轮加固在 `D:\CodingAgentHarness\.worktrees\final-delivery`、分支 `codex/final-delivery` 上执行，基线为 `origin/master` 的 `0fb39b8`。这是当前可观察事实。旧日志关于早期阶段是否从一开始使用 worktree 的描述互相矛盾，因此本轮不复述或修补那段历史。

### 任务切片

计划把风险拆成可独立验证的边界：

1. dangerous risk 是否真正进入最终执行治理。
2. memory 是否在 SQL、AgentLoop 和 Server 调用路径中保持项目隔离。
3. feedback 是否实际改变下一次 mock LLM 行动。
4. 打包后的 CLI 是否只依赖 package metadata，并清除 stale build chunk。
5. 本地凭据是否能在隔离路径完成真实 HTTP 生命周期。
6. 产品文档是否只保留当前证据支持的交付契约。

每个 brief 指定接口、目标文件、RED/GREEN 命令和原子提交；对应 report 保存实际输出、审查修复和未解决关注项。

### TDD 与审查

Tasks 1–5 都按 brief 先写行为测试并记录 RED，然后做最小实现、运行 GREEN，再接受独立审查。审查不是形式门槛：

- Task 1 经四轮修复，从“能阻断危险工具”收紧到 Registry 不可绕过、批准匹配不可变、批准一次性消费和 abort 安全。
- Task 2 经两轮修复，补上 Server 生产注入和删除的项目隔离。
- Task 3 经一轮修复，排除了无条件 FIFO 伪装成反馈因果性的可能。
- Task 5 审查要求恢复“最小实现后、refactor 前”的独立 GREEN 证据，报告据原始命令结果补齐，没有伪造新运行。

Task 6 也先增加可执行 scanner 测试：受控 stale 文档必须非零并输出七类诊断，受控 clean 文档必须为零。scanner 实现后，再对未修改的真实五份文档捕获 claim-level RED，最后才修正文档。

## 已确认的设计演进

### 工具治理

最初风险模型容易把安全性寄托在命令正则。Task 1 的回归测试表明，registered tool 的 `riskLevel` 本身必须进入最终 dispatch 决策。最终边界由 ToolRegistry 与 Governance 共同执行，AgentLoop 不能用松散布尔值跳过授权。

### 项目记忆

记忆实现使用 `sql.js`，避免 Windows 原生 SQLite 编译依赖。Task 2 进一步证明“表里有 project_path”不等于隔离完成：搜索、删除、AgentLoop retrieval 和 Server production injection 都必须携带同一项目身份。

### 反馈闭环

预先排队两个 mock 响应只能证明顺序，不能证明反馈导致修正。Task 3 让 selector 只观察实际发送给 LLM 的 request view；第二动作只有在消息包含结构化失败与 actionable fix 时才出现。

### 分发

CLI 原先依赖 monorepo 布局；Task 4 改为通过 `@harness/server` 的 exports 解析安装入口，并让 Server build 清理旧 chunk。这里发生了重要偏差：指定的完整自动 clean-install 在受限安装阶段超时，不能宣布自动验收成功。用户后来完成一次人工 clean-install、健康页、WebUI 和停止监听验证，这两类证据被明确分开。

### 凭据测试

原计划希望在 tarball verifier 中同时做凭据生命周期。由于 Task 4 已覆盖打包方向且真实默认凭据路径可能触及旧用户文件，Task 5 经协调收窄为本地 source Server 的隔离 HTTP 生命周期，并添加 `HARNESS_CREDENTIALS_FILE` 测试 seam。默认仍是 `~/.harness/credentials.enc`。

## 偏差清单

| 计划/早期说法 | 实际证据 | 当前处理 |
| --- | --- | --- |
| 公开入口不运行完整产品（旧说法已否定） | 运行时策略把 public 限制为固定 demo | 文档统一为 local 完整、public 演示 |
| 指定外部地址可访问 | 当前任务未验证任何地址 | 移除地址与上线保证 |
| 原生 SQLite driver | package 和实现使用 `sql.js` | SPEC/README 统一为 `sql.js` |
| Task 4 自动 clean-install 已闭合 | 自动运行超时；人工路径成功 | PLAN 标记部分闭合并保留自动化间隙 |
| Task 5 必须重复完整 tarball verifier | 协调后改为隔离 credentials seam 与 HTTP lifecycle | 报告说明范围变更，不冒充原计划全部完成 |
| 旧冷启动记录证明从零复现 | 仓库只有叙述，缺少可独立核验的原始会话证据 | 明确标为历史自述，不作为当前验收 |

## 本轮没有执行的操作

- 未发布 npm package 或 release。
- 未推送分支、创建 PR 或修改 master。
- 未使用真实 API Key 或主密码。
- 未修改 `REFLECTION.md`，也未代写学生反思。
- 未把旧测试总数、外部操作或无法复现的会话细节包装成事实。

## 可复用教训

1. 文档状态必须绑定命令、日期和 commit；“全部完成”会掩盖局部自动化间隙。
2. 安全边界要测试最终执行点，而不是只 grep 配置或断言 helper。
3. 反馈测试必须证明因果关系，不只是先后顺序。
4. 环境隔离 seam 应保持默认生产行为不变，并在测试中验证 fallback 没有被触碰。
5. 人工端到端成功有价值，但必须与自动化可重复性分别记录。
6. 无法从仓库核验的旧流程应被标注，而不是用更流畅的故事补齐。
