# Coding Agent Harness · Implementation Plan

> **Status: ALL PHASES COMPLETE ✅ — 450+ tests passing, 62 tasks done (current state as of 2026-08-08)**

> **Note for cold-start validation:** Tasks 1–3 (scaffolding, types, Vitest config) are prerequisites for any implementation task. A cold-start agent must first establish the project skeleton before implementing later tasks.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript Coding Agent Harness with Web-first interface, feedback loop as the core contribution, and mock-LLM-driven deterministic tests.

**Architecture:** Monorepo with three packages — `@harness/core` (pure logic, mock-testable), `@harness/server` (Express + React full-stack app), `@harness/cli` (optional local runner). All core mechanisms are injected interfaces; the AgentLoop is a bare orchestrator.

**Tech Stack:** TypeScript, Node.js 18+, Express, React (Vite), DeepSeek API (OpenAI-compatible), better-sqlite3, Vitest, npm workspaces.

---

## Phase 1: 项目骨架 & 类型定义 (Tasks 1–5)

### Task 1: Monorepo 初始化

**Files:**
- Create: `package.json` (root)
- Create: `tsconfig.base.json`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`

**Goal:** 建立 npm workspaces monorepo 结构，三个包可独立编译。

**Key decisions:**
- Root `package.json` 使用 `"workspaces": ["packages/*"]`
- `@harness/core` 为纯库，`"type": "module"`
- `@harness/server` 依赖 `@harness/core` + `express` + `react` + `vite`
- `@harness/cli` 依赖 `@harness/core`
- **devDependencies (TypeScript, Vitest, tsup) 在此阶段声明，确保后续 task 可编译和测试**

**Dependencies to add to `packages/core/package.json`:**
```json
{
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "tsup": "^8.0.0",
    "@types/node": "^20.0.0",
    "@types/uuid": "^10.0.0"
  }
}
```

**Test:**
- `npm install` 在根目录成功
- `npx tsc --noEmit` 在 core 包下通过（即使无源文件）

**Verification:**
```bash
npm install              # 应成功安装 + 建立 workspace symlinks
cd packages/core && npx tsc --noEmit  # 应通过
```

---

### Task 2: 核心类型定义

**Files:**
- Create: `packages/core/src/types.ts`

**Goal:** 定义所有共享类型，后续所有 task 都依赖此文件。

**Interface signatures to define:**

```typescript
// LLM 层
interface AgentContext { messages: Message[]; tools: ToolDefinition[]; memory: MemoryEntry[]; config: AgentConfig; feedbackState: FeedbackState | null; }
interface AgentResponse { content: string; toolCalls: ToolCallRequest[]; rawContent?: string; responseId?: string; model?: string; latencyMs?: number; usage?: { promptTokens: number; completionTokens: number; totalTokens: number; }; }
interface ToolCallRequest { id: string; name: string; arguments: Record<string, unknown>; }
interface Message { role: "system" | "user" | "assistant" | "tool"; content: string; toolCallId?: string; name?: string; }
// LLMAdapter 接口定义在 llm/adapter.ts (Task 6)，types.ts 不重复定义

// 工具层
interface ToolDefinition { name: string; description: string; parameters: Record<string, unknown>; } // OpenAI tool schema
interface Tool { definition: ToolDefinition; execute(params: Record<string, unknown>): Promise<ToolResult>; riskLevel: RiskLevel; }
interface ToolResult { success: boolean; output: string; error?: string; }
type RiskLevel = "safe" | "moderate" | "dangerous";

// 护栏
type GuardrailDecision = "allowed" | "blocked" | "ask_user";
type HITLState = "running" | "blocked" | "waiting_user" | "approved" | "rejected";

// 反馈闭环
interface FeedbackResult { status: "pass" | "fail" | "error"; failures: TestFailure[]; actionableFix: FixSuggestion | null; }
interface TestFailure { file: string; line: number; type: "syntax" | "assertion" | "timeout" | "runtime"; message: string; diff: string; }
interface FixSuggestion { summary: string; failures: TestFailure[]; suggestedActions: string[]; }
interface FeedbackState { lastResult: FeedbackResult; iteration: number; }

// 记忆
interface MemoryEntry { id: string; type: "convention" | "decision" | "knowledge" | "rule"; content: string; source: string; createdAt: Date; lastAccessedAt: Date; }

// 配置
interface AgentConfig { maxIterations: number; testCommand: string; allowedTools: string[]; blockedCommands: string[]; ignoredPaths: string[]; }

// 会话
interface Session { id: string; createdAt: Date; task: string; messages: Message[]; toolCalls: ToolCallRecord[]; feedbackRuns: FeedbackRun[]; status: "running" | "blocked" | "completed" | "failed"; conclusion: string | null; }
interface ToolCallRecord { timestamp: Date; toolName: string; params: Record<string, unknown>; result: ToolResult; guardrailCheck: "passed" | "blocked" | "approved_by_user"; }
interface FeedbackRun { iteration: number; testResult: "pass" | "fail"; failureCount: number; fixApplied: boolean; timeSpent: number; }

// 主循环
interface AgentLoopResult { status: "completed" | "blocked" | "failed" | "max_iterations"; session: Session; }
```

**Test:**
- `packages/core/test/types.test.ts` — 编译时类型检查，验证类型可导入

**Verification:**
```bash
cd packages/core && npx tsc --noEmit  # 类型定义文件编译通过
```

---

### Task 3: Vitest 测试框架配置

**Files:**
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/test/.gitkeep` (删除，改为 ts 文件后删除)

**Goal:** 配置 Vitest，使 `npm test` 可运行 core 包的所有测试。

**Key config:**
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { globals: true, environment: 'node', include: ['test/**/*.test.ts'] }
});
```

**Verification:**
```bash
cd packages/core && npm test  # 应显示 "No test files found" 而非报错
```

---

### Task 4: 根目录 package.json 脚本

**Files:**
- Modify: `package.json` (root)

**Goal:** 添加根级别 `npm test` 和 `npm run build` 脚本，一键运行所有包。

**Scripts to add:**
```json
{
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present",
    "lint": "tsc --noEmit --project tsconfig.base.json"
  }
}
```

**Verification:**
```bash
npm test   # 应遍历所有 workspace 运行测试
```

---

### Task 5: CI 配置

**Files:**
- Create: `.github/workflows/ci.yml`

**Goal:** GitHub Actions 在每次 push 时自动运行测试。

**Job definition:**
- `unit-test`: checkout → setup Node.js 18 → `npm install` → `npm test`

**Verification:**
```bash
# 推送后到 GitHub Actions 页面查看，第一次应显示 pass（即使无测试文件）
```

---

**Phase 1 完成状态：** monorepo 可编译、可测试、CI 就绪。

| Task | Commit | Status |
|------|--------|--------|
| Task 1: Monorepo 初始化 | `efded2f` | ✅ |
| Task 2: 核心类型定义 | `87fb62a` | ✅ |
| Task 3: Vitest 配置 | `f417cf5` | ✅ |
| Task 4: 根目录脚本 | `b59f203` | ✅ |
| Task 5: CI 配置 | `b59f203` | ✅ |

**依赖：** 无（Phase 1 是基础，所有后续 task 依赖此阶段）

---

## Phase 2: LLM 抽象层 + Mock (Tasks 6–9)

### Task 6: LLMAdapter 接口

**Files:**
- Create: `packages/core/src/llm/adapter.ts`
- Create: `packages/core/test/llm/adapter.test.ts`

**Goal:** 定义 `LLMAdapter` 接口，它是所有 LLM 调用的唯一入口，也是 mock 测试的根基。

**Interface:**
```typescript
import { AgentContext, AgentResponse } from '../types.js';

export interface LLMAdapter {
  /** 发送上下文到 LLM，返回响应。这是 harness 与 LLM 的唯一接触点。 */
  sendMessage(context: AgentContext): Promise<AgentResponse>;
}
```

**Test (compile-time + 实现验证):**
- 接口本身无可执行逻辑，但需要验证 `adapter.ts` 模块存在且可被导入
- 使用 `tsc --noEmit` 验证类型（Vitest 会擦除纯类型导入，不能独立验证纯类型模块存在）
- 同时保留 Vitest 运行时测试作为辅助：

```typescript
import { describe, it, expect } from 'vitest';
import { LLMAdapter } from '../../src/llm/adapter.js';
import { AgentContext, AgentResponse } from '../../src/types.js';

describe('LLMAdapter interface', () => {
  it('should be implementable by a mock', () => {
    // Type-level test: 验证 mock 实现满足接口
    const mock: LLMAdapter = {
      sendMessage: async (_ctx: AgentContext): Promise<AgentResponse> => ({
        content: 'test', toolCalls: []
      })
    };
    expect(typeof mock.sendMessage).toBe('function');
  });
});
```

**Verification:**
```bash
cd packages/core && npx tsc --noEmit           # 类型检查通过（验证接口模块存在）
cd packages/core && npx vitest run test/llm/adapter.test.ts  # 运行时测试通过
```

---

### Task 7: MockLLMAdapter

**Files:**
- Create: `packages/core/src/llm/mock.ts`
- Create: `packages/core/test/llm/mock.test.ts`

**Goal:** 实现 `MockLLMAdapter`，按顺序返回预制响应。这是所有后续机制确定性测试的基础。

**Interface:**
```typescript
import { LLMAdapter } from './adapter.js';
import { AgentContext, AgentResponse } from '../types.js';

export class MockLLMAdapter implements LLMAdapter {
  constructor(private responses: AgentResponse[]);
  sendMessage(context: AgentContext): Promise<AgentResponse>;
  /** 返回剩余未消费的响应数 */
  get remainingCount(): number;
}
```

**Behavior:**
- 构造函数接收 `AgentResponse[]` 数组
- 构造函数**浅复制**输入数组到内部存储，不修改调用者传入的数组
- `sendMessage()` 每次调用按 FIFO 顺序返回下一个响应
- 如果响应耗尽，抛出 `MockLLMExhaustedError`（定义在 `mock.ts` 中导出，`extends Error`，无参构造，消息为 `"MockLLMAdapter: no more responses"`）
- `remainingCount` 返回剩余响应数

**Test cases:**
1. 按顺序返回预制响应
2. 第三次调用返回第三个响应
3. 响应耗尽时抛出 `MockLLMExhaustedError`
4. `remainingCount` 初始 = 数组长度，每次调用后递减

**Verification:**
```bash
cd packages/core && npx vitest run test/llm/mock.test.ts
```

---

### Task 8: DeepSeekAdapter

**Files:**
- Create: `packages/core/src/llm/deepseek.ts`
- Create: `packages/core/test/llm/deepseek.test.ts`

**Goal:** 实现真实 LLM 适配器，调用 DeepSeek API（兼容 OpenAI 格式）。

**Interface:**
```typescript
import { LLMAdapter } from './adapter.js';
import { AgentContext, AgentResponse } from '../types.js';

export class DeepSeekAdapter implements LLMAdapter {
  constructor(options: { apiKey: string; model?: string; baseUrl?: string });
  sendMessage(context: AgentContext): Promise<AgentResponse>;
}
```

**Behavior:**
- 使用 `openai` npm 包，配置 `baseURL: "https://api.deepseek.com"`
- 将 `AgentContext.messages` 映射为 OpenAI chat completions 格式
- 将 `AgentContext.tools` 映射为 OpenAI function calling 格式
- 解析响应中的 `tool_calls` 为 `AgentResponse.toolCalls`
- 默认 model: `deepseek-chat`
- 失败时抛出 `LLMCallError`（含状态码和消息）

**Test (mock HTTP 不依赖网络):**
- 使用 `nock` 或 `msw` mock HTTP 请求
- 测试：正确发送 API 请求、正确解析响应、正确处理工具调用返回、API 错误映射为 `LLMCallError`

**Verification:**
```bash
cd packages/core && npx vitest run test/llm/deepseek.test.ts
```

---

### Task 9: ResponseParser

**Files:**
- Create: `packages/core/src/llm/response-parser.ts`
- Create: `packages/core/test/llm/response-parser.test.ts`

**Goal:** 解析 LLM 原始响应，提取纯文本和工具调用。这是 AgentLoop 中"解析动作"步骤的实现。

**Interface:**
```typescript
import { AgentResponse, ToolCallRequest } from '../types.js';

export interface ParsedResponse {
  text: string;
  toolCalls: ToolCallRequest[];
  /** 判断 LLM 是否声明任务完成 */
  isComplete: boolean;
}

export function parseResponse(response: AgentResponse): ParsedResponse;
```

**Behavior:**
- 提取 `response.content` 为 `text`
- 透传 `response.toolCalls`
- `isComplete` 判定：content 中包含 "TASK_COMPLETE" 或 "任务完成" 或 无 toolCalls 且内容以总结语气结束

**Test cases:**
1. 仅文本无工具调用 → `toolCalls: []`, `isComplete: true`
2. 包含工具调用 → `toolCalls` 正确传递
3. 包含 TASK_COMPLETE 标记 → `isComplete: true`
4. 有工具调用且无完成标记 → `isComplete: false`

**Verification:**
```bash
cd packages/core && npx vitest run test/llm/response-parser.test.ts
```

---

**Phase 2 完成状态：** LLM 层可 mock 测试、可接入真实 API，响应解析就绪。

| Task | Commit | Status |
|------|--------|--------|
| Task 6: LLMAdapter 接口 | `fb28956` | ✅ |
| Task 7: MockLLMAdapter | `2446233` | ✅ |
| Task 8: DeepSeekAdapter | `b3e4aba` | ✅ |
| Task 9: ResponseParser | `8032083` | ✅ |

**依赖：** Phase 1 (Task 1-5) | **可并行：** Tasks 6-9 串行（逐层依赖）

---

## Phase 3: 工具系统 (Tasks 10–17)

### Task 10: Tool 接口 + ToolRegistry

**Files:**
- Create: `packages/core/src/tools/tool.ts`
- Create: `packages/core/test/tools/tool.test.ts`

**Goal:** 实现工具注册表，支持注册、查找、参数校验、执行工具。

**Interface:**
```typescript
import { Tool, ToolDefinition, ToolResult, RiskLevel } from '../types.js';

export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): ToolDefinition[];           // 返回所有工具定义（给 LLM 的 function schema）
  execute(name: string, params: Record<string, unknown>): Promise<ToolResult>;
  getByRiskLevel(level: RiskLevel): Tool[];  // 供护栏按风险等级筛选
}

export function createToolRegistry(): ToolRegistry;
```

**Behavior:**
- `register()` 注册工具，同名覆盖（后注册覆盖先注册）
- `get()` 按名称查找
- `list()` 返回所有 `Tool.definition`
- `execute()` 找到工具 → 执行 → 返回结果；找不到抛出 `ToolNotFoundError`
- `getByRiskLevel()` 返回指定风险等级的所有工具

**Test cases:**
1. 注册并查找工具
2. 执行工具返回正确结果
3. 执行不存在的工具抛出 `ToolNotFoundError`
4. `list()` 返回所有已注册工具定义
5. `getByRiskLevel("dangerous")` 只返回高风险工具
6. 同名覆盖

**Verification:**
```bash
cd packages/core && npx vitest run test/tools/tool.test.ts
```

---

### Task 11: read_file 工具

**Files:**
- Create: `packages/core/src/tools/read-file.ts`
- Create: `packages/core/test/tools/read-file.test.ts`

**Goal:** 实现文件读取工具。风险等级：safe。

**Interface:**
```typescript
import { Tool } from '../types.js';

export function createReadFileTool(workspaceRoot: string): Tool;
```

**Behavior:**
- 参数：`{ path: string }` — 相对于 workspaceRoot 的文件路径
- 校验：禁止路径穿越（`../` 不可逃逸出 workspaceRoot）
- 返回：文件内容（UTF-8），或文件不存在的错误

**Test cases:**
1. 读取存在的文件 → 返回内容
2. 读取不存在的文件 → `success: false`, 含错误信息
3. 路径穿越攻击 → 被拦截，返回拒绝信息
4. 风险等级为 safe

**Verification:**
```bash
cd packages/core && npx vitest run test/tools/read-file.test.ts
```

---

### Task 12: write_file 工具

**Files:**
- Create: `packages/core/src/tools/write-file.ts`
- Create: `packages/core/test/tools/write-file.test.ts`

**Goal:** 实现文件写入工具。风险等级：moderate。

**Interface:**
```typescript
export function createWriteFileTool(workspaceRoot: string): Tool;
```

**Behavior:**
- 参数：`{ path: string, content: string }`
- 校验：路径穿越防护、不覆盖 `.git` 目录内文件
- 创建目录（如不存在）
- 返回：写入成功确认，或错误信息

**Test cases:**
1. 写入新文件 → 成功，文件内容正确
2. 覆盖已有文件 → 成功，内容更新
3. 路径穿越 → 被拦截
4. 写入 `.git/config` → 被拒绝
5. 风险等级为 moderate

**Verification:**
```bash
cd packages/core && npx vitest run test/tools/write-file.test.ts
```

---

### Task 13: execute_shell 工具

**Files:**
- Create: `packages/core/src/tools/execute-shell.ts`
- Create: `packages/core/test/tools/execute-shell.test.ts`

**Goal:** 执行 shell 命令。风险等级：moderate。

**Interface:**
```typescript
export function createExecuteShellTool(workspaceRoot: string, options?: { timeout?: number }): Tool;
```

**Behavior:**
- 参数：`{ command: string }`
- 使用 `child_process.exec` 执行
- 默认超时 30 秒
- 工作目录为 `workspaceRoot`
- 捕获 stdout + stderr
- 返回：`{ stdout, stderr, exitCode }`

**Test cases:**
1. 执行 `echo hello` → 返回 stdout 含 "hello"
2. 执行失败命令 → 返回 stderr + 非零 exitCode
3. 超时命令 → 超时错误
4. 风险等级为 moderate

**Verification:**
```bash
cd packages/core && npx vitest run test/tools/execute-shell.test.ts
```

---

### Task 14: run_tests 工具

**Files:**
- Create: `packages/core/src/tools/run-tests.ts`
- Create: `packages/core/test/tools/run-tests.test.ts`

**Goal:** 运行项目测试。风险等级：safe。这是反馈闭环的入口——agent 通过此工具触发测试。

**Interface:**
```typescript
export function createRunTestsTool(workspaceRoot: string, options?: { command?: string }): Tool;
```

**Behavior:**
- 参数：`{ command?: string }` — 可选自定义测试命令，默认 `npm test`
- 在 workspaceRoot 下执行
- 返回：stdout + stderr + exitCode（0 = pass, 非0 = fail）

**Test cases:**
1. 在测试项目中运行 → 返回 exitCode 0（pass）
2. 在测试项目中运行失败测试 → 返回 exitCode 非0 + 失败信息
3. 默认使用 `npm test`
4. 风险等级为 safe

**Verification:**
```bash
cd packages/core && npx vitest run test/tools/run-tests.test.ts
```

---

### Task 15: search_code 工具

**Files:**
- Create: `packages/core/src/tools/search-code.ts`
- Create: `packages/core/test/tools/search-code.test.ts`

**Goal:** 代码搜索（grep）。风险等级：safe。

**Interface:**
```typescript
export function createSearchCodeTool(workspaceRoot: string): Tool;
```

**Behavior:**
- 参数：`{ pattern: string, path?: string, fileTypes?: string }`
- 使用 ripgrep 或 Node.js 实现（优先用 `child_process.exec('rg ...')`，fallback 到 node fs 遍历）
- 返回匹配行列表：`[{ file, line, content }]`

**Test cases:**
1. 搜索存在的模式 → 返回匹配行
2. 搜索不存在的模式 → 返回空列表
3. 限制文件类型 → 只搜索对应类型
4. 风险等级为 safe

**Verification:**
```bash
cd packages/core && npx vitest run test/tools/search-code.test.ts
```

---

### Task 16: git_diff 工具

**Files:**
- Create: `packages/core/src/tools/git-diff.ts`
- Create: `packages/core/test/tools/git-diff.test.ts`

**Goal:** 查看 git 变更。风险等级：safe。

**Interface:**
```typescript
export function createGitDiffTool(workspaceRoot: string): Tool;
```

**Behavior:**
- 参数：无（或 `{ staged?: boolean }`）
- 执行 `git diff`（或 `git diff --cached`）
- 返回 diff 输出

**Test cases:**
1. 有变更时 → 返回 diff 内容
2. 无变更时 → 返回空字符串
3. 风险等级为 safe

**Verification:**
```bash
cd packages/core && npx vitest run test/tools/git-diff.test.ts
```

---

### Task 17: git_commit 工具

**Files:**
- Create: `packages/core/src/tools/git-commit.ts`
- Create: `packages/core/test/tools/git-commit.test.ts`

**Goal:** 提交代码。风险等级：**dangerous**（触发护栏拦截）。

**Interface:**
```typescript
export function createGitCommitTool(workspaceRoot: string): Tool;
```

**Behavior:**
- 参数：`{ message: string }`
- 执行 `git add -A && git commit -m "..."`（注意：-A 是 staging 所有文件）
- 风险等级为 dangerous → 护栏会拦截并要求用户确认

**Test cases:**
1. 有变更时 → 提交成功
2. 无变更时 → 返回 "nothing to commit"
3. 风险等级为 dangerous
4. 注意：测试需要在临时 git 仓库中运行

**Verification:**
```bash
cd packages/core && npx vitest run test/tools/git-commit.test.ts
```

---

**Phase 3 完成状态：** 7 个工具全部就绪，ToolRegistry 可注册/分发/按风险筛选。

| Task | Commit | Status |
|------|--------|--------|
| Task 10: ToolRegistry | `4f10970` | ✅ |
| Task 11: read_file | `f8380b6` | ✅ |
| Task 12: write_file | `cbf4d52` | ✅ |
| Task 13: execute_shell | `f59a464` | ✅ |
| Task 14: run_tests | `bca9191` | ✅ |
| Task 15: search_code | `d179bc1` | ✅ |
| Task 16: git_diff | `ed8fc27` | ✅ |
| Task 17: git_commit | `dfa94e1` | ✅ |

**依赖：** Phase 1-2 | **可并行：** Tasks 11-17 可并行（各工具独立）

---

## Phase 4: 护栏 + HITL (Tasks 18–22)

### Task 18: Guardrail 危险命令拦截

**Files:**
- Create: `packages/core/src/guardrail/guardrail.ts`
- Create: `packages/core/test/guardrail/guardrail.test.ts`

**Goal:** 实现危险动作拦截器——这是"机制必须是代码"的核心体现之一。

**Interface:**
```typescript
import { GuardrailDecision, ToolCallRequest } from '../types.js';

export interface Guardrail {
  /** 检查工具调用是否危险，返回决策 */
  check(toolCall: ToolCallRequest): GuardrailDecision;
  /** 添加自定义危险模式 */
  addPattern(pattern: RegExp, description: string): void;
}

export function createGuardrail(config?: { blockedCommands?: string[] }): Guardrail;
```

**Behavior — 内置危险模式：**
- `rm -rf` / `rm -r` / `rmdir` → blocked
- `DROP TABLE` / `DROP DATABASE` / `TRUNCATE` → blocked
- `git push --force` / `git push -f` → blocked
- `npm publish` / `yarn publish` → blocked
- `chmod 777` → blocked
- `> /dev/sd*` / `dd if=` → blocked
- `format` / `mkfs` → blocked
- 配置文件中的 `blockedCommands` 列表 → blocked

**Behavior — 决策逻辑：**
- 匹配危险模式 → `"blocked"`（需要用户确认）
- 不匹配 → `"allowed"`

**Test cases:**
1. `rm -rf /` → `"blocked"`
2. `echo hello` → `"allowed"`
3. `DROP TABLE users` → `"blocked"`
4. 自定义模式 → `"blocked"`
5. 大小写不敏感匹配
6. 空命令 → `"allowed"`

**Verification:**
```bash
cd packages/core && npx vitest run test/guardrail/guardrail.test.ts
```

---

### Task 19: HITL 状态机

**Files:**
- Create: `packages/core/src/guardrail/hitl.ts`
- Create: `packages/core/test/guardrail/hitl.test.ts`

**Goal:** 实现人工审批状态机，管理危险操作被拦截后的等待-审批流程。

**Interface:**
```typescript
import { HITLState, ToolCallRequest } from '../types.js';

export interface HITLManager {
  /** 当前状态 */
  state: HITLState;
  /** 被拦截的操作（等待审批时） */
  pendingAction: ToolCallRequest | null;
  /** 进入等待审批状态 */
  requestApproval(action: ToolCallRequest): void;
  /** 用户批准 */
  approve(): void;
  /** 用户拒绝 */
  reject(): void;
  /** 重置到运行状态 */
  reset(): void;
}

export function createHITLManager(): HITLManager;
```

**State machine:**
```
running → blocked → waiting_user → approved → running
                  → rejected → running（跳过该操作）
```

**Test cases:**
1. 初始状态为 `running`
2. `requestApproval()` → 状态变为 `waiting_user`，`pendingAction` 设置
3. `approve()` → 状态变为 `approved`，`pendingAction` 保留
4. `reject()` → 状态变为 `rejected`，`pendingAction` 保留
5. `reset()` → 状态回到 `running`，`pendingAction` 清空
6. 非 `waiting_user` 状态调用 `approve()` 抛出错误

**Verification:**
```bash
cd packages/core && npx vitest run test/guardrail/hitl.test.ts
```

---

### Task 20: Guardrail + HITL 集成

**Files:**
- Create: `packages/core/src/guardrail/index.ts`
- Create: `packages/core/test/guardrail/integration.test.ts`

**Goal:** 将 Guardrail 和 HITL 组合为完整的治理流程，供 AgentLoop 调用。

**Interface:**
```typescript
import { Guardrail } from './guardrail.js';
import { HITLManager } from './hitl.js';
import { ToolCallRequest } from '../types.js';

export interface GovernanceService {
  /** 预检：执行前检查。返回 true = 放行，false = 需要审批 */
  preCheck(toolCall: ToolCallRequest): boolean;
  /** 后检：执行后检查（预留，当前版本透传） */
  postCheck(toolCall: ToolCallRequest): boolean;
  /** 获取 HITL 管理器，供外部（Web/CLI）获取审批状态 */
  hitl: HITLManager;
}

export function createGovernanceService(config?: { blockedCommands?: string[] }): GovernanceService;
```

**Behavior:**
- `preCheck()`: 调用 `Guardrail.check()` → 若 `blocked` 则调用 `HITLManager.requestApproval()` 并返回 false
- `postCheck()`: 当前版本始终返回 true，预留扩展点
- `hitl` 暴露 HITL 管理器，供 Web 界面轮询审批状态

**Test cases:**
1. 安全命令 → `preCheck` 返回 true，`hitl.state` 保持 running
2. 危险命令 → `preCheck` 返回 false，`hitl.state` 变为 waiting_user
3. 用户 approve 后 → 下次 `preCheck` 返回 true（同一命令再次执行时）
4. 用户 reject 后 → 操作被跳过

**Verification:**
```bash
cd packages/core && npx vitest run test/guardrail/integration.test.ts
```

---

### Task 21: 护栏演示用例（机制演示 ①）

**Files:**
- Create: `packages/core/test/demo/guardrail-demo.test.ts`

**Goal:** 确定性演示：护栏拦截危险动作。这是交付物中"机制演示"的第 ① 部分。

**Scenario（用 MockLLMAdapter）:**
1. Mock LLM 返回一个调用 `execute_shell` 的 tool call，参数为 `rm -rf /`
2. AgentLoop 调用 `GovernanceService.preCheck()` → 返回 false
3. HITL 状态变为 `waiting_user`
4. 断言：危险命令未被实际执行

**Test structure:**
```typescript
describe('Guardrail Demo', () => {
  it('should block dangerous command and request user approval', async () => {
    // 1. 创建 mock LLM，返回一个危险的 tool call
    // 2. 创建 GovernanceService
    // 3. preCheck 返回 false
    // 4. HITL 状态为 waiting_user
    // 5. 验证工具未被调用
  });
});
```

**Verification:**
```bash
cd packages/core && npx vitest run test/demo/guardrail-demo.test.ts
```

---

### Task 22: 护栏维度收尾

**Files:**
- Modify: `packages/core/src/index.ts` (导出 governance 模块)

**Goal:** 确保护栏模块可被外部正确导入。

**Verification:**
```bash
cd packages/core && npx tsc --noEmit  # 类型检查通过
cd packages/core && npx vitest run test/guardrail/  # 所有护栏测试通过
```

---

**Phase 4 完成状态：** 危险命令拦截 + HITL 状态机 + 机制演示 ① 就绪。

| Task | Commit | Status |
|------|--------|--------|
| Task 18: Guardrail | `4339093` | ✅ |
| Task 19: HITL | `f3fd903` | ✅ |
| Task 20: 集成 | `cf1f291` | ✅ |
| Task 21: 演示 ① | `cf1f291` | ✅ |
| Task 22: 收尾 | `cf1f291` | ✅ |

**依赖：** Phase 1-3 | **可并行：** Tasks 18-19 可并行后合并

---

## Phase 5: 反馈闭环 ★ 重点维度 (Tasks 23–32)

### Task 23: TestRunner

**Files:**
- Create: `packages/core/src/feedback/test-runner.ts`
- Create: `packages/core/test/feedback/test-runner.test.ts`

**Goal:** 执行测试命令并捕获原始输出。这是反馈闭环的入口——可注入 mock 输出，不依赖真实测试。

**Interface:**
```typescript
export interface TestRunner {
  /** 运行测试，返回原始输出 */
  run(workingDir: string, command?: string): Promise<TestRunResult>;
}

export interface TestRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export function createTestRunner(): TestRunner;
```

**Behavior:**
- 默认命令 `npm test`，可自定义
- 使用 `child_process.exec` 执行，超时 60s
- 捕获 stdout + stderr + exitCode + 耗时

**Test cases:**
1. 测试通过（exitCode 0）→ 返回 stdout 含 pass 信息
2. 测试失败（exitCode 1）→ 返回 stdout 含 fail 信息 + stderr
3. 测试命令不存在 → exitCode 非0 + stderr 含错误
4. 自定义命令参数

**Verification:**
```bash
cd packages/core && npx vitest run test/feedback/test-runner.test.ts
```

---

### Task 24: ResultParser — Jest 格式解析

**Files:**
- Create: `packages/core/src/feedback/result-parser.ts`
- Create: `packages/core/test/feedback/result-parser.test.ts`

**Goal:** 解析测试输出，提取每个失败的详细信息。这是反馈闭环的"感知层"——将原始文本转为结构化数据。

**Interface:**
```typescript
import { TestFailure } from '../types.js';

export interface ResultParser {
  /** 解析测试输出，提取所有失败 */
  parse(stdout: string, stderr: string, exitCode: number): TestFailure[];
  /** 判断测试是否全部通过 */
  isPassed(exitCode: number): boolean;
}

export function createResultParser(): ResultParser;
```

**Behavior (Jest 格式):**
- 解析 `● test name` 块 → 提取测试名称
- 解析 `Expected:` / `Received:` 行 → 提取 diff
- 解析 `at Object.<anonymous> (path:line:col)` → 提取文件+行号
- 错误类型推断：`expect(...).toBe(...)` 不匹配 → assertion；`SyntaxError` → syntax；`Timeout` → timeout
- `isPassed()`: exitCode === 0 为 true

**Test cases:**
1. Jest 标准失败输出 → 正确提取文件、行号、expected/received
2. 多个失败 → 返回多个 TestFailure
3. 语法错误输出 → 类型为 syntax
4. 超时错误输出 → 类型为 timeout
5. exitCode 0 → `isPassed()` 返回 true
6. 空输出 + exitCode 1 → 返回空数组（无法解析但非崩溃）

**Verification:**
```bash
cd packages/core && npx vitest run test/feedback/result-parser.test.ts
```

---

### Task 25: FailureClassifier

**Files:**
- Create: `packages/core/src/feedback/failure-classifier.ts`
- Create: `packages/core/test/feedback/failure-classifier.test.ts`

**Goal:** 规则引擎分类失败，决定修复策略优先级。确定性代码，不依赖 LLM。

**Interface:**
```typescript
import { TestFailure } from '../types.js';

export type FailureCategory = "syntax" | "assertion" | "timeout" | "runtime";
export type FixPriority = "high" | "medium" | "low";

export interface ClassifiedFailure {
  failure: TestFailure;
  category: FailureCategory;
  priority: FixPriority;
}

export interface FailureClassifier {
  classify(failures: TestFailure[]): ClassifiedFailure[];
  /** 按优先级排序：high → medium → low */
  sortByPriority(failures: ClassifiedFailure[]): ClassifiedFailure[];
}

export function createFailureClassifier(): FailureClassifier;
```

**Priority rules:**
- syntax → high（定位明确，最易修复）
- assertion → medium（需要理解逻辑）
- runtime → medium（需要追溯调用栈）
- timeout → low（可能是性能问题，非逻辑错误）

**Test cases:**
1. syntax 错误 → 优先级 high
2. assertion 错误 → 优先级 medium
3. 多个不同类别 → 按优先级排序
4. 空列表 → 返回空数组

**Verification:**
```bash
cd packages/core && npx vitest run test/feedback/failure-classifier.test.ts
```

---

### Task 26: FixSuggestionBuilder

**Files:**
- Create: `packages/core/src/feedback/fix-suggestion.ts`
- Create: `packages/core/test/feedback/fix-suggestion.test.ts`

**Goal:** 将分类后的失败构建为结构化修复上下文，回灌给 LLM。这是反馈闭环的"表达能力"。

**Interface:**
```typescript
import { ClassifiedFailure } from './failure-classifier.js';
import { FixSuggestion } from '../types.js';

export interface FixSuggestionBuilder {
  build(failures: ClassifiedFailure[]): FixSuggestion;
  /** 构建注入到 LLM 上下文的提示文本 */
  toContextString(suggestion: FixSuggestion): string;
}

export function createFixSuggestionBuilder(): FixSuggestionBuilder;
```

**Behavior:**
- `build()`: 汇总失败信息 → 按优先级排序 → 生成修复建议
- `toContextString()`: 将 FixSuggestion 格式化为 LLM 可理解的文本，包含：
  - "以下测试失败，请修复："
  - 每个失败的文件、行号、错误类型、diff
  - 优先级排序的修复建议

**Test cases:**
1. 单个 syntax 失败 → 生成包含文件+行号的修复建议
2. 多个 assertion 失败 → 汇总所有 diff
3. `toContextString()` → 输出格式正确，含文件路径、行号、diff
4. 空失败列表 → `build()` 返回 null 的 FixSuggestion

**Verification:**
```bash
cd packages/core && npx vitest run test/feedback/fix-suggestion.test.ts
```

---

### Task 27: FeedbackLoop 编排

**Files:**
- Create: `packages/core/src/feedback/feedback-loop.ts`
- Create: `packages/core/test/feedback/feedback-loop.test.ts`

**Goal:** 将 TestRunner + ResultParser + FailureClassifier + FixSuggestionBuilder 串联为完整的反馈闭环。

**Interface:**
```typescript
import { FeedbackResult, FeedbackState } from '../types.js';
import { TestRunner } from './test-runner.js';
import { ResultParser } from './result-parser.js';
import { FailureClassifier } from './failure-classifier.js';
import { FixSuggestionBuilder } from './fix-suggestion.js';

export interface FeedbackLoop {
  /** 运行一次完整的反馈闭环，返回结果 */
  run(workingDir: string, state: FeedbackState | null): Promise<FeedbackResult>;
  /** 判断是否应该继续循环（未通过 + 未达最大轮次） */
  shouldContinue(result: FeedbackResult, state: FeedbackState | null, maxIterations: number): boolean;
}

export function createFeedbackLoop(
  testRunner: TestRunner,
  resultParser: ResultParser,
  failureClassifier: FailureClassifier,
  fixSuggestionBuilder: FixSuggestionBuilder
): FeedbackLoop;
```

**Behavior:**
- `run()`: testRunner.run() → resultParser.parse() → failureClassifier.classify() → fixSuggestionBuilder.build() → 返回 FeedbackResult
- `shouldContinue()`: 测试未通过 AND 当前轮次 < maxIterations → true
- 测试通过 → 直接返回，不继续

**Test cases（使用 mock TestRunner）:**
1. 测试通过 → run 返回 status: "pass"，shouldContinue 返回 false
2. 测试失败 → run 返回 status: "fail" + actionableFix，shouldContinue 返回 true
3. 达到最大轮次 → shouldContinue 返回 false（即使测试仍失败）
4. 反馈状态正确传递（iteration 递增）

**Verification:**
```bash
cd packages/core && npx vitest run test/feedback/feedback-loop.test.ts
```

---

### Task 28: 反馈闭环演示用例（机制演示 ②）

**Files:**
- Create: `packages/core/test/demo/feedback-demo.test.ts`

**Goal:** 确定性演示：注入失败 → 反馈闭环使 agent 根据反馈改变行为。这是交付物中"机制演示"的第 ② 部分。

**Scenario（用 MockLLMAdapter）:**
1. Mock LLM 第一次响应：调用 `write_file` 写一个有 bug 的代码
2. Mock TestRunner 返回：测试失败（预设的 Jest 失败输出）
3. 反馈闭环解析 → 分类 → 构建修复建议 → 回灌
4. Mock LLM 第二次响应：调用 `write_file` 写修复后的代码（内容不同）
5. Mock TestRunner 返回：测试通过
6. 断言：第二轮 LLM 调用携带了反馈上下文；第二轮修改了文件

**Test structure:**
```typescript
describe('Feedback Demo', () => {
  it('should detect failure, feed back to LLM, and fix the code', async () => {
    // 1. Mock LLM: 第1次 → 写 bug 代码, 第2次 → 写修复代码
    // 2. Mock TestRunner: 第1次 → fail, 第2次 → pass
    // 3. 运行 AgentLoop
    // 4. 断言：FeedbackLoop 运行了2轮
    // 5. 断言：LLM 共被调用2次，第2次携带了 feedbackState
    // 6. 断言：最终文件内容为修复后的版本
  });
});
```

**Verification:**
```bash
cd packages/core && npx vitest run test/demo/feedback-demo.test.ts
```

---

### Task 29: 多轮修正演示（机制演示 ③ — 重点维度）

**Files:**
- Create: `packages/core/test/demo/deep-demo.test.ts`

**Goal:** 确定性演示反馈闭环的深度行为——多轮修正、失败分类、超出上限时人工介入。这是交付物中"机制演示"的第 ③ 部分，对应重点维度。

**Scenario 1 — 多轮修正直到通过:**
1. Mock LLM 第1轮：写代码 → 测试失败（assertion）
2. Mock LLM 第2轮：第一次修复 → 测试仍失败（另一个 assertion）
3. Mock LLM 第3轮：第二次修复 → 测试通过
4. 断言：共3轮，每轮失败类型不同，最终通过

**Scenario 2 — 超出最大轮次:**
1. Mock LLM 连续5轮都无法修复
2. 第5轮后 `shouldContinue()` 返回 false
3. 断言：agent 状态为 `"failed"`，提示人工介入

**Scenario 3 — 失败类型演进:**
1. 第1轮：syntax 错误 → 修复 → 第2轮：assertion 错误 → 修复 → 通过
2. 断言：不同轮次的不同错误类型被正确分类

**Verification:**
```bash
cd packages/core && npx vitest run test/demo/deep-demo.test.ts
```

---

### Task 30: ResultParser 插件化扩展点

**Files:**
- Modify: `packages/core/src/feedback/result-parser.ts`
- Create: `packages/core/test/feedback/result-parser-plugins.test.ts`

**Goal:** 为 ResultParser 添加插件机制，支持不同测试框架（Jest / Vitest / pytest / go test）。先实现 Jest + Vitest，预留扩展点。

**Interface extension:**
```typescript
export interface ParserPlugin {
  name: string;
  /** 判断此插件是否能解析该输出 */
  canParse(stdout: string): boolean;
  /** 解析输出 */
  parse(stdout: string, stderr: string): TestFailure[];
}

export function createResultParser(plugins?: ParserPlugin[]): ResultParser;
```

**Behavior:**
- 默认注册 JestPlugin 和 VitestPlugin
- `parse()` 遍历插件，使用第一个 `canParse()` 返回 true 的插件
- 无插件匹配时返回空数组（不崩溃）

**Test cases:**
1. Jest 输出 → JestPlugin 解析
2. Vitest 输出 → VitestPlugin 解析
3. 未知格式 → 返回空数组
4. 自定义插件注册生效

**Verification:**
```bash
cd packages/core && npx vitest run test/feedback/result-parser-plugins.test.ts
```

---

### Task 31: 反馈模块导出

**Files:**
- Modify: `packages/core/src/index.ts` (导出 feedback 模块)

**Goal:** 确保反馈闭环模块可被外部正确导入。

**Verification:**
```bash
cd packages/core && npx tsc --noEmit
cd packages/core && npx vitest run test/feedback/  # 所有反馈测试通过
```

---

### Task 32: 反馈闭环维度收尾

**Files:**
- Modify: `packages/core/src/feedback/index.ts` (统一导出)

**Goal:** 反馈闭环模块完整可用，所有测试通过。

**Verification:**
```bash
cd packages/core && npx vitest run test/feedback/ test/demo/feedback-demo.test.ts test/demo/deep-demo.test.ts
```

---

**Phase 5 完成状态：** 反馈闭环完整实现（TestRunner → ResultParser → FailureClassifier → FixSuggestionBuilder → FeedbackLoop），含插件化解析器、3 个演示用例。

| Task | Commit | Status |
|------|--------|--------|
| Task 23: TestRunner | `aee5335` | ✅ |
| Task 24: ResultParser | `7d66471` | ✅ |
| Task 25: FailureClassifier | `243536e` | ✅ |
| Task 26: FixSuggestionBuilder | `a3c8247` | ✅ |
| Task 27: FeedbackLoop | `ddc1099` | ✅ |
| Task 28: 演示 ② | `dba0ce3` | ✅ |
| Task 29: 演示 ③ | `dba0ce3` | ✅ |
| Task 30: 插件化 | `dba0ce3` | ✅ |
| Task 31: 导出 | `dba0ce3` | ✅ |
| Task 32: 收尾 | `dba0ce3` | ✅ |

**依赖：** Phase 1-4 | **可并行：** Tasks 23-26 串行（流水线依赖），Tasks 28-32 可并行

---

## Phase 6: 记忆 + 配置 (Tasks 33–37)

### Task 33: MemoryStore

**Files:**
- Create: `packages/core/src/memory/memory-store.ts`
- Create: `packages/core/test/memory/memory-store.test.ts`

**Goal:** 实现跨会话记忆存储与检索。使用 SQLite (better-sqlite3)，按项目隔离。

**Interface:**
```typescript
import { MemoryEntry } from '../types.js';

export interface MemoryStore {
  add(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'lastAccessedAt'>): Promise<MemoryEntry>;
  search(query: string, options?: { type?: string; limit?: number }): Promise<MemoryEntry[]>;
  list(projectPath: string): Promise<MemoryEntry[]>;
  delete(id: string): Promise<void>;
  getByType(projectPath: string, type: MemoryEntry['type']): Promise<MemoryEntry[]>;
}

export function createMemoryStore(dbPath: string): Promise<MemoryStore>;
```

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  project_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL
);
```

**Behavior:**
- `add()`: 插入记忆，自动生成 UUID + 时间戳
- `search()`: 关键词 LIKE 匹配，按 lastAccessedAt 降序
- `list()`: 按 projectPath 过滤
- `delete()`: 按 ID 删除
- `getByType()`: 按类型过滤

**Test cases:**
1. 写入并读取记忆 → 内容一致
2. 关键词搜索 → 匹配的结果返回
3. 按项目隔离 → 不同项目记忆不互见
4. 按类型过滤 → 只返回指定类型
5. 删除记忆 → 后续查询不包含
6. lastAccessedAt 在 search 时更新

**Verification:**
```bash
cd packages/core && npx vitest run test/memory/memory-store.test.ts
```

---

### Task 34: ContextBuilder

**Files:**
- Create: `packages/core/src/loop/context-builder.ts`
- Create: `packages/core/test/loop/context-builder.test.ts`

**Goal:** 构建 LLM 上下文——拼装系统提示、工具列表、记忆、反馈状态。

**Interface:**
```typescript
import { AgentContext, AgentConfig, FeedbackState, Message, ToolDefinition, MemoryEntry } from '../types.js';

export interface ContextBuilder {
  build(options: {
    task: string;
    messages: Message[];
    tools: ToolDefinition[];
    memories: MemoryEntry[];
    config: AgentConfig;
    feedbackState: FeedbackState | null;
  }): AgentContext;
}

export function createContextBuilder(systemPrompt?: string): ContextBuilder;
```

**Behavior:**
- 构建 system message（含工具使用说明 + 配置规则 + 记忆上下文）
- 注入反馈状态（如果有上一轮测试失败信息）
- 按顺序排列：system → memories as context → conversation history → latest task

**Test cases:**
1. 基本上下文构建 → 包含 system + user 消息
2. 有记忆时 → 上下文包含记忆内容
3. 有反馈状态时 → 上下文包含测试失败信息
4. 工具列表正确传递给 context
5. 配置规则传递正确

**Verification:**
```bash
cd packages/core && npx vitest run test/loop/context-builder.test.ts
```

---

### Task 35: ConfigLoader

**Files:**
- Create: `packages/core/src/config/config-loader.ts`
- Create: `packages/core/test/config/config-loader.test.ts`

**Goal:** 加载声明式配置文件 `.harness/config.yaml`，提供默认值。

**Interface:**
```typescript
import { AgentConfig } from '../types.js';

export interface ConfigLoader {
  load(projectPath: string): Promise<AgentConfig>;
  getDefaults(): AgentConfig;
  validate(config: unknown): config is AgentConfig;
}

export function createConfigLoader(): ConfigLoader;
```

**Default config:**
```yaml
maxIterations: 20
testCommand: "npm test"
allowedTools: ["*"]
blockedCommands:
  - "rm -rf"
  - "DROP TABLE"
  - "git push --force"
  - "npm publish"
ignoredPaths:
  - "node_modules"
  - ".git"
  - "dist"
```

**Behavior:**
- 查找 `.harness/config.yaml`，不存在则用默认配置
- 合并用户配置与默认值（用户值覆盖默认）
- `validate()` 校验配置结构
- 格式错误时抛出 `ConfigValidationError`

**Test cases:**
1. 无配置文件 → 返回默认配置
2. 有配置文件 → 用户值覆盖默认值
3. 配置格式错误 → 抛出 ConfigValidationError
4. blockedCommands 合并正确
5. 部分配置 → 未设置项使用默认值

**Verification:**
```bash
cd packages/core && npx vitest run test/config/config-loader.test.ts
```

---

### Task 36: 记忆 + 配置模块导出

**Files:**
- Modify: `packages/core/src/index.ts` (导出 memory + config 模块)

**Verification:**
```bash
cd packages/core && npx tsc --noEmit
cd packages/core && npx vitest run test/memory/ test/config/
```

---

### Task 37: StopCondition

**Files:**
- Create: `packages/core/src/loop/stop-condition.ts`
- Create: `packages/core/test/loop/stop-condition.test.ts`

**Goal:** 停机判断逻辑。纯函数，无副作用。

**Interface:**
```typescript
export type StopReason = "task_complete" | "max_iterations" | "user_terminated" | "blocked_waiting";

export interface StopCondition {
  check(options: {
    isComplete: boolean;
    testPassed: boolean;
    currentIteration: number;
    maxIterations: number;
    hitlState: string;
  }): { shouldStop: boolean; reason: StopReason | null };
}

export function createStopCondition(): StopCondition;
```

**Behavior:**
- `isComplete + testPassed` → stop, reason: "task_complete"
- `currentIteration >= maxIterations` → stop, reason: "max_iterations"
- `hitlState === "waiting_user"` → stop, reason: "blocked_waiting"
- 其他 → 不停止

**Test cases:**
1. 完成 + 测试通过 → 停止
2. 完成但测试未通过 → 不停止（继续修正）
3. 达到最大轮次 → 停止
4. HITL 等待中 → 停止
5. 正常进行中 → 不停止

**Verification:**
```bash
cd packages/core && npx vitest run test/loop/stop-condition.test.ts
```

---

**Phase 6 完成状态：** 记忆存储、上下文构建、配置加载、停机判断全部就绪。

| Task | Commit | Status |
|------|--------|--------|
| Task 33: MemoryStore | `073c905` | ✅ |
| Task 34: ContextBuilder | `073c905` | ✅ |
| Task 35: ConfigLoader | `073c905` | ✅ |
| Task 36: 导出 | `073c905` | ✅ |
| Task 37: StopCondition | `073c905` | ✅ |

**依赖：** Phase 1-5 | **可并行：** Tasks 33, 35, 37 可并行（独立模块）

---

## Phase 7: Agent 主循环 + 集成 (Tasks 38–43)

### Task 38: AgentLoop 主循环

**Files:**
- Create: `packages/core/src/loop/agent-loop.ts`
- Create: `packages/core/test/loop/agent-loop.test.ts`

**Goal:** 实现裸循环编排器——将所有组件串联为可运行的 agent。循环本身不包含任何具体逻辑，一切通过接口注入。

**Interface:**
```typescript
import { LLMAdapter } from '../llm/adapter.js';
import { ToolRegistry } from '../tools/tool.js';
import { GovernanceService } from '../guardrail/index.js';
import { FeedbackLoop } from '../feedback/feedback-loop.js';
import { ContextBuilder } from './context-builder.js';
import { StopCondition } from './stop-condition.js';
import { AgentLoopResult, AgentConfig } from '../types.js';

export interface AgentLoop {
  /** 运行 agent，执行用户任务 */
  run(task: string, workingDir: string): Promise<AgentLoopResult>;
  /** 处理 HITL 审批（用户批准/拒绝被拦截的操作） */
  handleApproval(approved: boolean): void;
  /** 终止运行 */
  abort(): void;
}

export interface AgentLoopDependencies {
  llm: LLMAdapter;
  tools: ToolRegistry;
  governance: GovernanceService;
  feedback: FeedbackLoop;
  contextBuilder: ContextBuilder;
  stopCondition: StopCondition;
  config: AgentConfig;
}

export function createAgentLoop(deps: AgentLoopDependencies): AgentLoop;
```

**核心循环逻辑（伪代码）：**
```
1. 初始化 messages = [system prompt, user task]
2. while (true):
   a. 构建上下文: contextBuilder.build(task, messages, tools, memories, config, feedbackState)
   b. 调用 LLM: llm.sendMessage(context)
   c. 解析响应: parseResponse(response)
   d. 对每个 toolCall:
      - governance.preCheck(toolCall) → 若 blocked → 暂停，等待 HITL
      - tool.execute(toolCall) → 记录结果
   e. 如果执行了 run_tests:
      - feedbackLoop.run(workingDir, feedbackState)
      - 将反馈结果注入 messages
   f. 停机判断: stopCondition.check(...)
      - 若应停止 → break
   g. iteration++
```

**Test cases（使用 MockLLMAdapter + Mock 所有依赖）:**
1. 简单任务完成 → LLM 声明 TASK_COMPLETE，循环结束
2. 工具调用分发 → LLM 调用 write_file，工具被正确执行
3. 反馈闭环触发 → run_tests 后触发 feedbackLoop
4. 护栏拦截 → 危险命令被 preCheck 拦截，循环暂停
5. 达到最大轮次 → 循环终止，状态为 max_iterations

**Verification:**
```bash
cd packages/core && npx vitest run test/loop/agent-loop.test.ts
```

---

### Task 39: Session 持久化

**Files:**
- Create: `packages/core/src/loop/session-store.ts`
- Create: `packages/core/test/loop/session-store.test.ts`

**Goal:** 会话存储与读取——JSON 文件存储到 `~/.harness/sessions/`。

**Interface:**
```typescript
import { Session } from '../types.js';

export interface SessionStore {
  save(session: Session): Promise<void>;
  load(id: string): Promise<Session | null>;
  list(limit?: number): Promise<Session[]>;
  delete(id: string): Promise<void>;
}

export function createSessionStore(basePath: string): SessionStore;
```

**Behavior:**
- `save()`: 写入 `{basePath}/{id}.json`
- `load()`: 读取并反序列化
- `list()`: 列出所有会话，按时间倒序
- `delete()`: 删除对应文件

**Test cases:**
1. 保存并加载 → 数据一致
2. 列出所有会话 → 按时间排序
3. 删除会话 → 后续加载返回 null
4. 不存在的会话 → load 返回 null

**Verification:**
```bash
cd packages/core && npx vitest run test/loop/session-store.test.ts
```

---

### Task 40: core 包统一导出

**Files:**
- Modify: `packages/core/src/index.ts`

**Goal:** 统一导出所有模块，外部只需 `import { ... } from '@harness/core'`。

**Exports:**
```typescript
// LLM
export { LLMAdapter } from './llm/adapter.js';
export { MockLLMAdapter } from './llm/mock.js';
export { DeepSeekAdapter } from './llm/deepseek.js';
export { parseResponse } from './llm/response-parser.js';

// Tools
export { createToolRegistry, ToolRegistry } from './tools/tool.js';
export { createReadFileTool } from './tools/read-file.js';
export { createWriteFileTool } from './tools/write-file.js';
export { createExecuteShellTool } from './tools/execute-shell.js';
export { createRunTestsTool } from './tools/run-tests.js';
export { createSearchCodeTool } from './tools/search-code.js';
export { createGitDiffTool } from './tools/git-diff.js';
export { createGitCommitTool } from './tools/git-commit.js';

// Governance
export { createGovernanceService, GovernanceService } from './guardrail/index.js';
export { createGuardrail, Guardrail } from './guardrail/guardrail.js';
export { createHITLManager, HITLManager } from './guardrail/hitl.js';

// Feedback
export { createFeedbackLoop, FeedbackLoop } from './feedback/feedback-loop.js';
export { createTestRunner, TestRunner } from './feedback/test-runner.js';
export { createResultParser, ResultParser } from './feedback/result-parser.js';
export { createFailureClassifier, FailureClassifier } from './feedback/failure-classifier.js';
export { createFixSuggestionBuilder, FixSuggestionBuilder } from './feedback/fix-suggestion.js';

// Memory
export { createMemoryStore, MemoryStore } from './memory/memory-store.js';

// Config
export { createConfigLoader, ConfigLoader } from './config/config-loader.js';

// Loop
export { createAgentLoop, AgentLoop } from './loop/agent-loop.js';
export { createContextBuilder, ContextBuilder } from './loop/context-builder.js';
export { createStopCondition, StopCondition } from './loop/stop-condition.js';
export { createSessionStore, SessionStore } from './loop/session-store.js';

// Types
export * from './types.js';
```

**Verification:**
```bash
cd packages/core && npx tsc --noEmit
cd packages/core && npm test  # 所有测试通过
```

---

### Task 41: core 包 build 配置

**Files:**
- Modify: `packages/core/package.json` (添加 build script)
- Modify: `packages/core/tsconfig.json` (配置输出)

**Goal:** 配置 tsup 打包，使 `@harness/core` 可被其他 workspace 包正常 import。

**package.json scripts:**
```json
{
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "test": "vitest run",
    "dev": "vitest"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

**Verification:**
```bash
cd packages/core && npm run build  # 生成 dist/ 目录
cd packages/core && npm test       # 所有测试仍通过
```

---

### Task 42: 依赖安装

**Files:**
- Modify: `packages/core/package.json` (添加 dependencies)

**Note:** 编译和测试所需的 devDependencies (TypeScript, Vitest, tsup) 已在 Phase 1 Task 1 中声明。此 task 补充运行时依赖。

**Dependencies to add:**
```json
{
  "dependencies": {
    "openai": "^4.0.0",
    "better-sqlite3": "^11.0.0",
    "yaml": "^2.0.0",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "tsup": "^8.0.0",
    "@types/better-sqlite3": "^7.0.0",
    "@types/uuid": "^10.0.0",
    "nock": "^13.0.0"
  }
}
```

**Verification:**
```bash
cd packages/core && npm install
cd packages/core && npx tsc --noEmit  # 类型检查通过
```

---

### Task 43: core 包全部测试通过

**Goal:** 确认 `@harness/core` 所有测试通过，为后续 server/cli 包做好准备。

**Verification:**
```bash
cd packages/core && npm test  # 预期：所有测试通过，无失败
cd packages/core && npm run build  # 预期：构建成功
```

---

**Phase 7 完成状态：** AgentLoop 主循环完成，所有组件集成，`@harness/core` 可独立构建、全部测试通过。

| Task | Commit | Status |
|------|--------|--------|
| Task 38: AgentLoop | `d9790e8` | ✅ |
| Task 39: SessionStore | `d9790e8` | ✅ |
| Task 40: 统一导出 | `d9790e8` | ✅ |
| Task 41: build 配置 | `d9790e8` | ✅ |
| Task 42: 依赖安装 | `d9790e8` | ✅ |
| Task 43: 全部测试通过 | `d9790e8` | ✅ |

**依赖：** Phase 1-6 | **可并行：** Tasks 39-42 可并行

---

## Phase 8: Server + Web 前端 (Tasks 44–53)

### Task 44: Server 包初始化

**Files:**
- Modify: `packages/server/package.json` (添加依赖 + scripts)
- Modify: `packages/server/tsconfig.json` (配置编译)

**Goal:** 初始化 `@harness/server` 包，配置 Express + Vite + React 开发环境。

**package.json 关键配置:**
```json
{
  "name": "@harness/server",
  "scripts": {
    "dev": "tsx src/server.ts",
    "build": "tsup src/server.ts --format esm && vite build client/",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "@harness/core": "*",
    "express": "^4.21.0",
    "cors": "^2.8.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "vite": "^6.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0",
    "@vitejs/plugin-react": "^4.0.0"
  }
}
```

**Verification:**
```bash
cd packages/server && npm install
cd packages/server && npx tsc --noEmit  # 类型检查通过
```

---

### Task 45: Express Server 骨架

**Files:**
- Create: `packages/server/src/server.ts`
- Create: `packages/server/src/routes/agent.ts`
- Create: `packages/server/src/routes/session.ts`
- Create: `packages/server/src/routes/config.ts`
- Create: `packages/server/src/sse/sse-manager.ts`

**Goal:** Express 服务器骨架，提供 REST API + SSE 端点。

**Routes:**
| 方法 | 路径 | 功能 |
|------|------|------|
| `POST` | `/api/agent/run` | 启动 agent 任务 |
| `GET` | `/api/agent/stream/:sessionId` | SSE 事件流 |
| `POST` | `/api/agent/approve` | HITL 批准 |
| `POST` | `/api/agent/reject` | HITL 拒绝 |
| `GET` | `/api/sessions` | 会话列表 |
| `GET` | `/api/sessions/:id` | 会话详情 |
| `GET` | `/api/config/status` | 配置状态 |
| `POST` | `/api/config/key` | 更新 API Key |
| `DELETE` | `/api/config/key` | 删除 API Key |

**SSE Manager interface:**
```typescript
export interface SSEManager {
  /** 创建新的 SSE 连接 */
  createConnection(sessionId: string, res: Response): void;
  /** 推送事件 */
  push(sessionId: string, event: SSEEvent): void;
  /** 关闭连接 */
  close(sessionId: string): void;
}

export interface SSEEvent {
  type: "loop_step" | "tool_call" | "guardrail" | "feedback" | "complete" | "error";
  data: unknown;
  timestamp: Date;
}
```

**Verification:**
```bash
cd packages/server && npx tsx src/server.ts  # 启动后 curl http://localhost:3000/api/sessions 返回 []
```

---

### Task 46: Agent Route 实现

**Files:**
- Modify: `packages/server/src/routes/agent.ts`

**Goal:** 实现 `/api/agent/run`——接收任务，创建 AgentLoop，通过 SSE 实时推送每步状态。

**Behavior:**
1. 接收 `{ task: string, workingDir: string }`
2. 创建 Session + AgentLoop（注入所有 core 组件）
3. 运行 AgentLoop，每步通过 SSE push 事件：
   - `loop_step`: 当前轮次、LLM 响应内容
   - `tool_call`: 工具名称、参数、结果
   - `guardrail`: 危险命令拦截 → 暂停等待用户确认
   - `feedback`: 测试结果、失败详情
   - `complete`: 任务完成
4. 返回 sessionId

**SSE 事件格式:**
```
data: {"type":"loop_step","data":{"iteration":1,"content":"..."},"timestamp":"..."}
data: {"type":"tool_call","data":{"name":"write_file","result":{...}},"timestamp":"..."}
data: {"type":"feedback","data":{"status":"fail","failures":[...]},"timestamp":"..."}
data: {"type":"complete","data":{"sessionId":"...","status":"completed"},"timestamp":"..."}
```

**Verification:**
```bash
# 启动 server 后
curl -X POST http://localhost:3000/api/agent/run \
  -H "Content-Type: application/json" \
  -d '{"task":"write a hello world function","workingDir":"/tmp/test"}'
# 检查 SSE 流输出
```

---

### Task 47: Session Route 实现

**Files:**
- Modify: `packages/server/src/routes/session.ts`

**Goal:** 实现会话列表和详情接口，供前端历史回顾页面使用。

**Behavior:**
- `GET /api/sessions` → 返回 `Session[]`（按时间倒序，最多 50 条）
- `GET /api/sessions/:id` → 返回完整 Session（含 messages、toolCalls、feedbackRuns）

**Verification:**
```bash
curl http://localhost:3000/api/sessions          # 返回数组
curl http://localhost:3000/api/sessions/{id}      # 返回完整会话
```

---

### Task 48: Config Route 实现

**Files:**
- Modify: `packages/server/src/routes/config.ts`

**Goal:** 实现 API Key 管理接口。

**Behavior:**
- `GET /api/config/status` → 返回 `{ hasKey: boolean }`（不回显明文）
- `POST /api/config/key` → 接收 `{ key: string }`，存储到系统密钥链，验证有效性
- `DELETE /api/config/key` → 清除存储的 key

**Verification:**
```bash
curl http://localhost:3000/api/config/status
curl -X POST http://localhost:3000/api/config/key -H "Content-Type: application/json" -d '{"key":"sk-test"}'
```

---

### Task 49: Vite + React 前端初始化

**Files:**
- Create: `packages/server/client/index.html`
- Create: `packages/server/client/src/main.tsx`
- Create: `packages/server/client/src/App.tsx`
- Create: `packages/server/client/vite.config.ts`

**Goal:** 初始化 React 前端，Vite 开发服务器与 Express 联动。

**vite.config.ts:**
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3000' }
  },
  build: {
    outDir: '../dist/client'
  }
});
```

**App.tsx** — 简单的路由骨架：
- `/` → ChatPanel（对话界面）
- `/history` → SessionHistory（历史回顾）
- `/config` → ConfigPage（配置管理）

**Verification:**
```bash
cd packages/server && npx vite client  # 打开 http://localhost:5173 看到页面
```

---

### Task 50: ChatPanel 组件

**Files:**
- Create: `packages/server/client/src/components/ChatPanel.tsx`
- Create: `packages/server/client/src/hooks/useSSE.ts`

**Goal:** 对话界面——输入任务、实时显示 agent 执行过程、HITL 确认弹窗。

**ChatPanel 功能:**
- 顶部：任务输入框 + 发送按钮
- 中部：对话流（消息气泡 + 工具调用卡片）
- 实时更新（SSE 流式接收）
- 危险命令拦截时弹出确认框

**useSSE hook:**
```typescript
export function useSSE(sessionId: string | null): {
  events: SSEEvent[];
  isConnected: boolean;
  error: string | null;
};
```

**Verification:**
```bash
# 在浏览器中打开 http://localhost:5173
# 输入任务 → 看到实时对话流 → 工具调用卡片 → 反馈迭代
```

---

### Task 51: ToolCallCard + GuardrailDialog 组件

**Files:**
- Create: `packages/server/client/src/components/ToolCallCard.tsx`
- Create: `packages/server/client/src/components/GuardrailDialog.tsx`

**Goal:** 工具调用卡片（展示工具名、参数、结果）和 HITL 确认弹窗。

**ToolCallCard:**
- 图标 + 工具名称
- 可展开的参数/结果区域
- 色彩编码：safe=绿, moderate=黄, dangerous=红

**GuardrailDialog:**
- 模态弹窗："以下操作需要确认"
- 显示命令详情 + 风险说明
- 批准 / 拒绝按钮
- 调用 `POST /api/agent/approve` 或 `/api/agent/reject`

**Verification:**
```bash
# 在浏览器中触发危险命令 → 看到弹窗 → 点击批准/拒绝
```

---

### Task 52: FeedbackTimeline + SessionHistory 组件

**Files:**
- Create: `packages/server/client/src/components/FeedbackTimeline.tsx`
- Create: `packages/server/client/src/components/SessionHistory.tsx`

**Goal:** 反馈修正时间线和历史会话列表。

**FeedbackTimeline:**
- 纵向时间线展示每轮反馈迭代
- 每轮显示：轮次号、测试结果（pass/fail标记）、失败数量、耗时
- 可展开查看每轮的具体失败详情

**SessionHistory:**
- 会话列表（卡片式）
- 每项显示：任务摘要、时间、状态标签、反馈轮次
- 点击进入详情页

**Verification:**
```bash
# 浏览器中查看历史页面 → 会话列表 → 点击展开详情
```

---

### Task 53: Server 端到端可运行

**Files:**
- Modify: `packages/server/src/server.ts` (集成静态文件服务)

**Goal:** 生产模式下 Express 服务 Vite 构建的静态文件，`npm run build` 后单命令启动。

**production server:**
```typescript
// 生产模式：serve Vite 构建产物
app.use(express.static(path.join(__dirname, 'client')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'index.html'));
});
```

**Verification:**
```bash
cd packages/server && npm run build
cd packages/server && npm start
# 浏览器打开 http://localhost:3000 → 完整应用可用
```

---

**Phase 8 完成状态：** Server + Web 前端完整可用，agent 可以在浏览器中运行、实时展示、HITL 交互。

| Task | Commit | Status |
|------|--------|--------|
| Task 44: Server 初始化 | `d05e21f` | ✅ |
| Task 45: Express 骨架 | `d05e21f` | ✅ |
| Task 46: Agent Route | `d05e21f` | ✅ |
| Task 47: Session Route | `d05e21f` | ✅ |
| Task 48: Config Route | `d05e21f` | ✅ |
| Task 49: Vite+React 初始化 | `5844d59` | ✅ |
| Task 50: ChatPanel | `5844d59` | ✅ |
| Task 51: ToolCallCard+GuardrailDialog | `5844d59` | ✅ |
| Task 52: FeedbackTimeline+SessionHistory | `5844d59` | ✅ |
| Task 53: 端到端可运行 | `5844d59` | ✅ |

**依赖：** Phase 1-7 | **可并行：** Tasks 44-48（后端）与 Tasks 49-52（前端）可并行开发

---

## Phase 9: CLI + 部署 + 文档 (Tasks 54–62)

### Task 54: CLI 包初始化

**Files:**
- Modify: `packages/cli/package.json`

**Goal:** 实现 `@harness/cli` 最小可用 CLI——启动本地 Server + 打开浏览器。

**package.json 关键配置:**
```json
{
  "name": "@harness/cli",
  "bin": { "harness": "./dist/cli.js" },
  "scripts": {
    "build": "tsup src/cli.ts --format esm",
    "start": "node dist/cli.js"
  },
  "dependencies": {
    "@harness/core": "*",
    "@harness/server": "*",
    "open": "^10.0.0"
  }
}
```

**cli.ts 行为:**
1. 检查凭据（API Key 是否已配置）
2. 未配置 → 引导输入 → 存储到系统密钥链
3. 已配置 → 启动 Express Server（复用 @harness/server）
4. 自动打开浏览器到 `http://localhost:3000`
5. 打印 "Harness running at http://localhost:3000"

**Verification:**
```bash
cd packages/cli && npm install
cd packages/cli && npm run build
node dist/cli.js  # 启动，浏览器自动打开
```

---

### Task 55: 阿里云 ECS 部署配置

**Files:**
- Create: `Dockerfile` (根目录)
- Modify: `README.md` (添加部署说明)

**Goal:** 配置 Docker 容器化部署，适配阿里云 ECS 环境。

**Dockerfile 关键设计:**
- 多阶段构建：deps → build → production
- 基于 Node.js 22 Alpine
- 暴露 3000 端口
- HEALTHCHECK 通过 `/api/health` 端点

**Deployment steps:**
1. 阿里云控制台 → 创建 ECS 实例（推荐 2vCPU 2GB 经济型 e）
2. 安全组 → 入方向开放 3000 端口
3. 远程桌面登录 → 安装 Node.js 22+ → 拉取代码 → `npm install && npm run build` → 启动
4. 浏览器访问 `http://<公网IP>:3000`

**Verification:**
```bash
curl http://<公网IP>:3000/api/health  # 返回 {"status":"ok"}
```

---

### Task 56: 凭据管理（keytar 集成）

**Files:**
- Create: `packages/cli/src/credential.ts`
- Modify: `packages/server/src/routes/config.ts` (使用 keytar)

**Goal:** 实现跨平台安全凭据存储。使用 keytar 库封装 Windows Credential Manager / macOS Keychain / Linux Secret Service。

**Interface:**
```typescript
export interface CredentialStore {
  /** 存储凭据 */
  set(service: string, account: string, password: string): Promise<void>;
  /** 获取凭据 */
  get(service: string, account: string): Promise<string | null>;
  /** 删除凭据 */
  delete(service: string, account: string): Promise<void>;
}
```

**keytar 使用:**
- service: `"harness"`
- account: `"deepseek-api-key"`
- 非 Windows 平台 fallback：加密文件存储（AES-256-GCM + 主密码）

**Verification:**
```bash
# 在 CLI 中：
harness config status  # 显示 "API Key: configured" (不回显明文)
harness config update  # 输入新 key
harness config clear   # 清除 key
```

---

### Task 57: README.md

**Files:**
- Create: `README.md`

**Content (mandatory sections per general requirements):**

1. **项目简介** — 一句话 + 核心价值
2. **安装** — `npm install -g @harness/cli` 或 线上版 URL
3. **运行** — `harness` 或浏览器打开 `http://<公网IP>:3000`
4. **分发命令** — npm publish / Docker 部署步骤
5. **目录结构** — monorepo 包结构图
6. **安全边界说明** — 凭据存储方式、威胁模型、已知限制
7. **技术栈** — TypeScript, Express, React, DeepSeek, 阿里云 ECS
8. **部署架构** — GitHub → 阿里云 ECS，手动部署流程
9. **已知限制** — Windows 凭据存储、仅支持 Jest/Vitest 解析

**Verification:**
```bash
# 在 GitHub 仓库首页查看 README 渲染效果
```

---

### Task 58: AGENT_LOG.md 初始化

**Files:**
- Create: `AGENT_LOG.md`

**Goal:** 初始化 AGENT_LOG.md，记录从 Phase 1 开始的实现过程。

**Template:**
```markdown
# Agent Log

## 2026-07-25 — Project Setup
- **Task:** Phase 1, Tasks 1-5
- **Skills triggered:** executing-plans
- **Key decisions:** npm workspaces monorepo, TypeScript, Vitest
- **Output:** Monorepo skeleton, CI config, type definitions
- **Human intervention:** None
- **Lessons:** ...
```

**Verification:**
```bash
# 文件存在，内容持续更新
```

---

### Task 59: SPEC_PROCESS.md

**Files:**
- Create: `SPEC_PROCESS.md`

**Goal:** 记录 brainstorming 与 spec 生成过程（按通用要求 §4.4）。

**Required sections:**
1. Brainstorming 关键节点 — 智能体追问了哪些好问题
2. 至少 3 轮关键迭代的对话节选与处理决策
3. 哪些 AI 建议被采纳，哪些被推翻，为什么
4. 反思：brainstorming 技能做得好的地方与不足

**Verification:**
```bash
# 文件存在，内容完整覆盖 4 个要求
```

---

### Task 60: 冷启动验证记录

**Files:**
- Modify: `SPEC_PROCESS.md` (追加冷启动验证部分)

**Goal:** 用另一个 agent 仅凭 SPEC + PLAN 尝试实现 1-2 个 task，记录暴露的问题。

**Required content:**
1. 使用的第二个 agent 类型
2. 它在哪一步暂停并提问
3. 暴露了哪些 SPEC 缺陷
4. 它做出了哪些与原意不一致的解读
5. 你据此对 SPEC/PLAN 做了哪些修订

**Verification:**
```bash
# SPEC_PROCESS.md 包含冷启动验证章节
```

---

### Task 61: CI/CD 最终验证

**Files:**
- Modify: `.github/workflows/ci.yml` (确保完整)

**Goal:** CI 必须包含 unit-test job，且最后一次执行 pass。

**ci.yml 最终内容:**
```yaml
name: CI
on: [push, pull_request]
jobs:
  unit-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '18' }
      - run: npm install
      - run: npm test
```

**Verification:**
```bash
# 最后一次 push 后，GitHub Actions 显示 unit-test job pass
```

---

### Task 62: npm publish 配置

**Files:**
- Modify: `packages/core/package.json` (添加 publishConfig)
- Modify: `packages/server/package.json`
- Modify: `packages/cli/package.json`

**Goal:** 配置 npm 发布，使 `npm publish` 可发布三个包。

**publishConfig:**
```json
{
  "publishConfig": {
    "access": "public"
  }
}
```

**Verification:**
```bash
# 不实际 publish（需要 npm 账号），但确保配置正确
cd packages/core && npm pack --dry-run  # 应显示打包内容
```

---

## Phase 10: Public API Security (Tasks 1–8)

**Goal:** Preserve an anonymously accessible Web UI while replacing the public arbitrary-code-execution boundary with a deterministic demo path and an HTTPS-only BYOK path using restricted tools.

**Architecture:** Refactor Express into an injectable app factory, derive capabilities from a fail-closed runtime policy, issue server-owned sessions and workspaces, and build tool registries exclusively from server policy. Public demo execution uses an in-process scenario runner; public BYOK execution uses a transient DeepSeek adapter with file-only tools; trusted local mode retains the full tool set.

**Worktree:** `D:\CodingAgentHarness\.worktrees\public-api-security`
**Branch:** `codex/public-api-security`
**Base:** `origin/master / 4ab2b9d`

**Status:**

| Task | Description | Commit | Status |
|------|-------------|--------|--------|
| Task 1 | Injectable app test harness | `c35d31c` | ✅ |
| Task 2 | Policy-owned tool registries | `ea48b22` | ✅ |
| Task 3 | Server-owned workspace isolation | `b19709a` | ✅ |
| Task 4 | Safe public API boundaries | `07172ac` | ✅ |
| Task 5 | Transient BYOK credentials | `f608d95` | ✅ |
| Task 6 | Deterministic public demo | `746fde5` | ✅ |
| Task 7 | Public/local mode UI and in-memory BYOK | `87ec31a` | ✅ (fix round 1 pending) |
| Task 8 | Documentation and final verification | `pending` | 🔄 |

**Total commits:** 8 tasks + fix rounds, all on `codex/public-api-security`

**Dependencies:** Phase 1-9 (master base)

| Task | Commit | Status |
|------|--------|--------|
| Task 54: CLI 初始化 | `ddacaa6` | ✅ |
| Task 55: 阿里云 ECS 部署配置 | `ddacaa6` + `fdb4e2e` | ✅ |
| Task 56: 凭据管理 | `ddacaa6` + Phase 1 重写 | ✅ |
| Task 57: README.md | `ddacaa6` | ✅ |
| Task 58: AGENT_LOG.md | `ddacaa6` | ✅ |
| Task 59: SPEC_PROCESS.md | `ddacaa6` | ✅ |
| Task 60: 冷启动验证 | `47edb81` + Codex 验证 | ✅ |
| Task 61: CI/CD 验证 | `486dda7` | ✅ |
| Task 62: npm publish 配置 | `486dda7` | ✅ |

**依赖：** Phase 1-8 | **可并行：** Tasks 55-62 可并行（文档/配置/部署独立）