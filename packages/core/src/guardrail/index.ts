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

export function createGovernanceService(config?: { blockedCommands?: string[] }): GovernanceService {
  const guardrail = createGuardrail(config);
  const hitl = createHITLManager();
  const isApprovedAction = (toolCall: ToolCallRequest): boolean => (
    hitl.state === 'approved'
    && hitl.pendingAction?.id === toolCall.id
    && hitl.pendingAction.name === toolCall.name
  );
  const authorize = (toolCall: ToolCallRequest, riskLevel?: RiskLevel): ToolAuthorization => {
    if (isApprovedAction(toolCall)) {
      hitl.reset();
      return 'approved';
    }
    const decision = guardrail.check(toolCall, riskLevel);
    if (decision === 'blocked') {
      hitl.requestApproval(toolCall);
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
