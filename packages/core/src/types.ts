// @harness/core — Core type definitions
// All shared types used across the Coding Agent Harness

// ── LLM Layer ──

export interface LLMAdapter {
  sendMessage(context: AgentContext): Promise<AgentResponse>;
}

export interface AgentContext {
  messages: Message[];
  tools: ToolDefinition[];
  memory: MemoryEntry[];
  config: AgentConfig;
  feedbackState: FeedbackState | null;
}

export interface AgentResponse {
  content: string;
  toolCalls: ToolCallRequest[];
  /** LLM 返回的原始文本（用于调试/日志） */
  rawContent?: string;
  /** 供应商返回的响应 ID */
  responseId?: string;
  /** 模型名称，如 "deepseek-chat" */
  model?: string;
  /** 延迟（ms） */
  latencyMs?: number;
  /** Token 使用情况 */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
}

// ── Tool Layer ──

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Tool {
  definition: ToolDefinition;
  execute(params: Record<string, unknown>): Promise<ToolResult>;
  riskLevel: RiskLevel;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export type RiskLevel = "safe" | "moderate" | "dangerous";

// ── Governance ──

export type GuardrailDecision = "allowed" | "blocked" | "ask_user";

export type HITLState = "running" | "blocked" | "waiting_user" | "approved" | "rejected";

// ── Feedback Loop ──

export interface FeedbackResult {
  status: "pass" | "fail" | "error";
  failures: TestFailure[];
  actionableFix: FixSuggestion | null;
}

export interface TestFailure {
  file: string;
  line: number;
  type: "syntax" | "assertion" | "timeout" | "runtime";
  message: string;
  diff: string;
}

export interface FixSuggestion {
  summary: string;
  failures: TestFailure[];
  suggestedActions: string[];
}

export interface FeedbackState {
  lastResult: FeedbackResult;
  iteration: number;
}

// ── Memory ──

export interface MemoryEntry {
  id: string;
  type: "convention" | "decision" | "knowledge" | "rule";
  content: string;
  source: string;
  projectPath: string;
  createdAt: Date;
  lastAccessedAt: Date;
}

// ── Config ──

export interface AgentConfig {
  maxIterations: number;
  testCommand: string;
  allowedTools: string[];
  blockedCommands: string[];
  ignoredPaths: string[];
}

// ── Session ──

export interface Session {
  id: string;
  createdAt: Date;
  task: string;
  messages: Message[];
  toolCalls: ToolCallRecord[];
  feedbackRuns: FeedbackRun[];
  status: "running" | "blocked" | "completed" | "failed";
  conclusion: string | null;
}

export interface ToolCallRecord {
  timestamp: Date;
  toolName: string;
  params: Record<string, unknown>;
  result: ToolResult;
  guardrailCheck: "passed" | "blocked" | "approved_by_user";
}

export interface FeedbackRun {
  iteration: number;
  testResult: "pass" | "fail";
  failureCount: number;
  fixApplied: boolean;
  timeSpent: number;
}

// ── Main Loop ──

export interface AgentLoopResult {
  status: "completed" | "blocked" | "failed" | "max_iterations";
  session: Session;
}