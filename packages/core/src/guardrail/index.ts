import { Guardrail, createGuardrail } from './guardrail.js';
import { HITLManager, createHITLManager } from './hitl.js';
import { RiskLevel, ToolCallRequest } from '../types.js';

export interface GovernanceService {
  preCheck(toolCall: ToolCallRequest, riskLevel?: RiskLevel): boolean;
  postCheck(toolCall: ToolCallRequest): boolean;
  hitl: HITLManager;
}

export function createGovernanceService(config?: { blockedCommands?: string[] }): GovernanceService {
  const guardrail = createGuardrail(config);
  const hitl = createHITLManager();

  return {
    preCheck(toolCall: ToolCallRequest, riskLevel?: RiskLevel): boolean {
      const decision = guardrail.check(toolCall, riskLevel);
      if (decision === 'blocked') {
        hitl.requestApproval(toolCall);
        return false;
      }
      return true;
    },

    postCheck(_toolCall: ToolCallRequest): boolean {
      return true; // Reserved for future extensions
    },

    hitl,
  };
}
