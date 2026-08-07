import { AgentResponse, ToolCallRequest } from '../types.js';

export interface ParsedResponse {
  text: string;
  toolCalls: ToolCallRequest[];
  isComplete: boolean;
}

const COMPLETE_MARKERS = [
  'TASK_COMPLETE',
  '任务完成',  // Chinese marker — toUpperCase() is a no-op for CJK, which is fine
  'TASK COMPLETE',
];

/**
 * Parse an LLM response into structured form.
 * Pure function — no side effects, no network, no LLM dependency.
 */
export function parseResponse(response: AgentResponse): ParsedResponse {
  const text = response.content;
  const toolCalls = response.toolCalls;

  // Check for explicit completion markers
  const hasCompleteMarker = COMPLETE_MARKERS.some(marker =>
    text.toUpperCase().includes(marker.toUpperCase()),
  );

  // Only treat as complete if the LLM explicitly signals completion.
  // A text-only response without tool calls is NOT necessarily complete —
  // the LLM may be thinking/planning. The LLM should use TASK_COMPLETE
  // when finished, or make a tool call to continue.
  const isComplete = hasCompleteMarker;

  return { text, toolCalls, isComplete };
}