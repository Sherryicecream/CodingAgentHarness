# Cold-Start Validation Prompt

你需要扮演一个**独立验证者**。你将收到一个项目的 `SPEC.md`（规格说明）和 `PLAN.md`（实现计划）。你的任务是：

1. 仅凭这两个文档，尝试实现 **Task 6** 和 **Task 7**（在 PLAN.md 的 Phase 2 中）
2. 过程中的每一步，如果遇到**任何不确定、模糊、或需要猜测才能继续的地方**，**立即暂停并提问**，不要凭猜测继续
3. 记录你在哪里卡住了、为什么卡住、以及你发现了 SPEC/PLAN 中的哪些缺陷

## 实现要求

- 实现文件放在 `packages/core/src/llm/` 目录下
- 测试文件放在 `packages/core/test/llm/` 目录下
- 使用 TypeScript (strict mode)，ESM 模块
- 测试框架使用 Vitest
- 前置条件中创建的 types.ts 定义了所有共享类型

## 任务描述

### 前置条件

开始前，你需要先搭建最小可验证的项目脚手架：
- 根级 npm workspace 配置（`package.json` 含 `"workspaces": ["packages/*"]`）
- `packages/core/package.json`（ESM、TypeScript、Vitest 开发依赖）
- `packages/core/tsconfig.json`（strict mode，extends 根配置）
- `tsconfig.base.json`（根级共享配置）
- `packages/core/vitest.config.ts`（Vitest 配置）
- 根据 PLAN.md Task 2 创建完整 `types.ts`（不自行增删领域类型）

### Task 6: LLMAdapter 接口

在 PLAN.md 中，Task 6 定义了 `LLMAdapter` 接口。请：
1. 创建 `packages/core/src/llm/adapter.ts`，导出 `LLMAdapter` 接口
2. 创建 `packages/core/test/llm/adapter.test.ts`，编写类型检查测试

### Task 7: MockLLMAdapter

在 PLAN.md 中，Task 7 定义了 `MockLLMAdapter`。请：
1. 创建 `packages/core/src/llm/mock.ts`，实现 `MockLLMAdapter` 类
2. 创建 `packages/core/test/llm/mock.test.ts`，编写 PLAN 中列出的所有测试用例

## 工作方式

- 先读 `SPEC.md` 理解整体架构，再读 `PLAN.md` 找到具体任务
- 每当你遇到任何模糊之处，**立即提问**
- 当你认为实现完成时，运行测试并报告结果