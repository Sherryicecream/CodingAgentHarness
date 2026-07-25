import { AgentResponse, ToolCallRequest } from '../types.js';

export interface ParsedResponse {
  text: string;
  toolCalls: ToolCallRequest[];
  isComplete: boolean;
}

const COMPLETE_MARKERS = [
  'TASK_COMPLETE',
  '任务完成',
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

  // If no tool calls and no complete marker, check if text looks like a final answer
  const looksLikeFinalAnswer = toolCalls.length === 0 && text.length > 0;

  const isComplete = hasCompleteMarker || looksLikeFinalAnswer;

  return { text, toolCalls, isComplete };
}