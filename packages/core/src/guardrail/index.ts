import { Guardrail, createGuardrail } from './guardrail.js';
import { HITLManager, createHITLManager } from './hitl.js';
import { RiskLevel, ToolCallRequest } from '../types.js';

export interface GovernanceService {
  preCheck(toolCall: ToolCallRequest, riskLevel?: RiskLevel): boolean;
  isApprovedAction(toolCall: ToolCallRequest): boolean;
  completeApprovedAction(toolCall: ToolCallRequest): void;
  postCheck(toolCall: ToolCallRequest): boolean;
  hitl: HITLManager;
}

export function createGovernanceService(config?: { blockedCommands?: string[] }): GovernanceService {
  const guardrail = createGuardrail(config);
  const hitl = createHITLManager();
  const isApprovedAction = (toolCall: ToolCallRequest): boolean => (
    hitl.state === 'approved'
    && hitl.pendingAction?.id === toolCall.id
    && hitl.pendingAction.name === toolCall.name
  );

  return {
    preCheck(toolCall: ToolCallRequest, riskLevel?: RiskLevel): boolean {
      if (isApprovedAction(toolCall)) {
        return true;
      }
      const decision = guardrail.check(toolCall, riskLevel);
      if (decision === 'blocked') {
        hitl.requestApproval(toolCall);
        return false;
      }
      return true;
    },

    isApprovedAction,

    completeApprovedAction(toolCall: ToolCallRequest): void {
      if (isApprovedAction(toolCall)) {
        hitl.reset();
      }
    },

    postCheck(_toolCall: ToolCallRequest): boolean {
      return true; // Reserved for future extensions
    },

    hitl,
  };
}
