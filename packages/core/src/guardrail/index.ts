import { Guardrail, createGuardrail } from './guardrail.js';
import { HITLManager, createHITLManager } from './hitl.js';
import { RiskLevel, ToolCallRequest } from '../types.js';

export type ToolAuthorization = 'allowed' | 'approved' | 'blocked';

export interface GovernanceService {
  preCheck(toolCall: ToolCallRequest, riskLevel?: RiskLevel): boolean;
  authorize(toolCall: ToolCallRequest, riskLevel?: RiskLevel): ToolAuthorization;
  isApprovedAction(toolCall: ToolCallRequest): boolean;
  postCheck(toolCall: ToolCallRequest): boolean;
  hitl: HITLManager;
}

const serializeApprovalValue = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `array:[${value.map(serializeApprovalValue).join(',')}]`;
  }

  switch (typeof value) {
    case 'object': {
      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => `${JSON.stringify(key)}:${serializeApprovalValue(entryValue)}`);
      return `object:{${entries.join(',')}}`;
    }
    case 'string':
      return `string:${JSON.stringify(value)}`;
    case 'number':
      return `number:${Object.is(value, -0) ? '-0' : String(value)}`;
    case 'bigint':
      return `bigint:${value.toString()}`;
    case 'boolean':
      return `boolean:${value}`;
    case 'undefined':
      return 'undefined';
    default:
      return `${typeof value}:${String(value)}`;
  }
};

const approvalKey = (toolCall: ToolCallRequest): string => (
  serializeApprovalValue({
    id: toolCall.id,
    name: toolCall.name,
    arguments: toolCall.arguments,
  })
);

export function createGovernanceService(config?: { blockedCommands?: string[] }): GovernanceService {
  const guardrail = createGuardrail(config);
  const hitl = createHITLManager();
  let pendingApprovalKey: string | null = null;
  const isApprovedAction = (toolCall: ToolCallRequest): boolean => (
    hitl.state === 'approved'
    && pendingApprovalKey === approvalKey(toolCall)
  );
  const authorize = (toolCall: ToolCallRequest, riskLevel?: RiskLevel): ToolAuthorization => {
    if (isApprovedAction(toolCall)) {
      hitl.reset();
      pendingApprovalKey = null;
      return 'approved';
    }
    if (hitl.state === 'approved') {
      hitl.reset();
      pendingApprovalKey = null;
    }
    const decision = guardrail.check(toolCall, riskLevel);
    if (decision === 'blocked') {
      hitl.requestApproval(toolCall);
      pendingApprovalKey = approvalKey(toolCall);
      return 'blocked';
    }
    return 'allowed';
  };

  return {
    preCheck(toolCall: ToolCallRequest, riskLevel?: RiskLevel): boolean {
      return authorize(toolCall, riskLevel) !== 'blocked';
    },

    authorize,

    isApprovedAction,

    postCheck(_toolCall: ToolCallRequest): boolean {
      return true; // Reserved for future extensions
    },

    hitl,
  };
}
