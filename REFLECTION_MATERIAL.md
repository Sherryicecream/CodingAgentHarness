# REFLECTION 写作素材

> 以下是为 REFLECTION.md 整理的过程总结素材。包含关键数据、事件回顾、决策点，供你撰写自己的反思时参考。
>
> **注意：** 按课程要求，反思报告必须由学生本人撰写。以下素材不是最终报告，而是帮助你回忆和组织的参考资料。

---

## 一、项目概况

| 项目 | 说明 |
|------|------|
| 项目名称 | Coding Agent Harness（编码智能体工作台） |
| 项目类型 | AI4SE 期末项目 A 类 · Coding Agent Harness |
| 技术栈 | TypeScript, Node.js, Express, React, DeepSeek, SQLite, Vitest |
| 代码量 | 3 个 npm 包（@harness/core / @harness/server / @harness/cli），278 个测试 |
| 实现周期 | 2026-07-25 至 2026-08-03（约 10 天） |
| 核心贡献 | 反馈闭环（Feedback Loop）——自动化的测试驱动修复迭代 |

## 二、关键时间线

### 2026-07-25（第 1 天）
- **Phase 1-7 全部完成**：从 Monorepo 搭建到 Agent 主循环集成
- 完成了 43 个 task，278 个测试全部通过
- 使用 Superpowers 的 `subagent-driven-development` 技能驱动
- **关键决策**：npm workspaces monorepo、TypeScript 严格模式、MockLLMAdapter 确定性测试

### 2026-07-25（第 1 天，续）
- **Phase 8-9 完成**：Server + 前端 + CLI + 文档
- 共 62 个 task 全部完成
- 前端使用 React 19 + Vite，SSE 实时推送
- 部署目标从 Render 改为阿里云 ECS（Docker 容器化）

### 2026-08-03（收尾阶段）
- **冷启动验证补做**：用 Codex 实现 Tasks 6+7，发现 8 个缺陷
- **凭据管理重写**：从 keytar 改为 AES-256-GCM 加密文件
- **UI 中文化 + 引导增强**：欢迎引导卡片、全界面中文化

## 三、Superpowers 技能使用记录

### 实际使用的技能

| 技能 | 使用阶段 | 使用频率 | 效果评估 |
|------|---------|---------|---------|
| `brainstorming` | 项目启动时 | 1 次 | 产出 SPEC 核心设计，追问了风险等级、反馈闭环范围等关键问题 |
| `writing-plans` | 项目启动时 | 1 次 | 产出 62 个 task 的 PLAN.md |
| `subagent-driven-development` | 实现阶段 | 反复使用 | 每个 task 派发一个 subagent 完成 |
| `test-driven-development` | 实现阶段 | 持续使用 | 红-绿-重构循环 |
| `requesting-code-review` | 每阶段末 | 约 8 次 | 两阶段评审（spec 合规 + 代码质量） |
| `finishing-a-development-branch` | 每阶段末 | 约 9 次 | 决定 merge/保留/丢弃 |

### 未使用的技能

| 技能 | 未使用原因 |
|------|-----------|
| `using-git-worktrees` | 项目为单人开发，且 deadline 紧张，未使用 worktree 隔离 |
| `executing-plans` | 选择了 `subagent-driven-development` 而非 `executing-plans` |

## 四、关键数据点

### 代码规模
- 核心包 @harness/core：约 40KB 编译产物
- 测试文件：31 个，278 个测试用例
- 全部测试可在 5 秒内完成（无需 LLM API 调用）

### Task 颗粒度
- 共 62 个 task
- 大部分 task 由 1 个 subagent 在 1 次会话内完成
- 最粗的 task 是 Phase 8（前端整体），实际上分了 10 个子 task
- 最细的 task 是单个工具（如 read_file、write_file），每个约 100-200 行代码

### 冷启动验证
- 初轮：ChatGPT 对话，15 分钟，发现 3 个缺陷
- 正式：Codex 实现，30 分钟，发现 8 个缺陷（3 个高严重度）
- 结论：**仅提问不实现，会严重高估规约的清晰度**

## 五、关键决策回顾

### 做对的决定
1. **MockLLMAdapter 优先**：所有机制可确定性测试，CI 快速可靠
2. **关注点分离**：Harness 做工程（提供上下文），LLM 做智能（生成修复）
3. **Web 优先架构**：SSE 实时推送 + HITL 弹窗比 CLI 更有说服力
4. **接口注入模式**：每个机制可独立 Mock 测试

### 可以改进的决定
1. **部署目标多次变更**：Vercel → Render → 阿里云 ECS，浪费了时间
2. **CLI 范围过大**：最终只是薄服务器启动器，不应当做独立功能规划
3. **Windows 兼容性考虑不足**：部分 Shell 命令假定 Unix 路径
4. **冷启动验证做晚了**：全部实现后才补做，应该按要求在实现前做

## 六、REFLECTION.md 各章节写作提示

### 1. Superpowers 技能评估
- Brainstorming 追问了哪些好问题？（参考 SPEC_PROCESS.md 的迭代节选）
- Subagent 是否偏离过方向？是如何纠正的？
- 两阶段评审在实际执行中是否真的每步都做了？

### 2. TDD 在 AI 协作下的体验
- 278 个测试是否真的有用？有没有哪个 bug 是测试帮你抓住的？
- 在 subagent 驱动开发中，红-绿-重构是否被严格执行了？
- 你认为 TDD 是阻碍还是放大器？

### 3. Subagent 工作流评估
- 每个 subagent 能自主运行多久？平均每个 task 耗时？
- 最常在哪里卡住？（类型定义？测试配置？）
- 什么样的 task 颗粒度最优？

### 4. SPEC/PLAN 质量与实现质量的关系
- 冷启动验证发现了 8 个缺陷，这说明 SPEC 中存在哪些隐性知识？
- 举一个"规约不清导致 subagent 偏离"的具体案例

### 5. Prompt / Context 策略
- 给 subagent 的 prompt 中，哪些信息最关键？
- 最有效的 prompt 策略是什么？

### 6. 凭据与分发的工程思考
- API Key 从 keytar 改为 AES-256-GCM 加密文件，为什么？
- 部署目标从 Render 改为阿里云 ECS，遇到了哪些坑？
- 如果下次做，会从一开始就做什么不同的部署决策？

### 7. 如果重做，你会改变什么？
- 技术栈？架构？重点维度？开发流程？测试策略？

### 8. 对 Superpowers 方法论的整体批判
- 它假设了什么？（TDD 是好的、计划先于实现、评审是必要的）
- 这些假设在你的项目里成立吗？
- 哪些设计确实有用？哪些只是在走形式？

### 9. 总体收获
- 完成项目前，你对 AI 辅助编程的看法是什么？
- 现在有什么变化？
- "当 LLM 能完成大部分编码工作时，一个工程师的真正价值在哪里"——你的答案？

---

## 七、参考数据

### 测试覆盖率
- 31 个测试文件覆盖：LLM 层、工具系统、护栏、反馈闭环、记忆、配置、主循环
- 所有测试无需网络和真实 LLM
- 3 个机制演示用例：护栏拦截、反馈修正、多轮修复

### 凭据安全设计
- 存储：AES-256-GCM 加密文件，密钥由机器主机名 + 用户名派生
- 验证：首次运行引导式隐藏输入 → 测试连接 → 确认
- 生产：DEEPSEEK_API_KEY 环境变量

### 分发
- Docker 容器化（Dockerfile + .dockerignore）
- npm 包准备就绪（publishConfig 已配置）
- 阿里云 ECS 部署指南已在 README 中说明