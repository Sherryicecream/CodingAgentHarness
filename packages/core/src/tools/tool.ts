import { Tool, ToolDefinition, ToolResult, RiskLevel } from '../types.js';
import { createGovernanceService, type GovernanceService } from '../guardrail/index.js';

export class ToolNotFoundError extends Error {
  constructor(name: string) {
    super(`Tool not found: ${name}`);
    this.name = 'ToolNotFoundError';
  }
}

export class ToolApprovalRequiredError extends Error {
  constructor(name: string) {
    super(`Tool approval required: ${name}`);
    this.name = 'ToolApprovalRequiredError';
  }
}

export interface ToolExecutionContext {
  toolCallId?: string;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): ToolDefinition[];
  execute(name: string, params: Record<string, unknown>, context?: ToolExecutionContext): Promise<ToolResult>;
  setGovernance(governance: GovernanceService): void;
  getByRiskLevel(level: RiskLevel): Tool[];
}

export function createToolRegistry(governance: GovernanceService = createGovernanceService()): ToolRegistry {
  const tools = new Map<string, Tool>();
  let executionGovernance = governance;

  return {
    register(tool: Tool): void {
      tools.set(tool.definition.name, tool);
    },

    get(name: string): Tool | undefined {
      return tools.get(name);
    },

    list(): ToolDefinition[] {
      return Array.from(tools.values()).map(t => t.definition);
    },

    async execute(name: string, params: Record<string, unknown>, context?: ToolExecutionContext): Promise<ToolResult> {
      const tool = tools.get(name);
      if (!tool) {
        throw new ToolNotFoundError(name);
      }
      if (!executionGovernance.preCheck({
        id: context?.toolCallId ?? `tool:${name}`,
        name,
        arguments: params,
      }, tool.riskLevel)) {
        throw new ToolApprovalRequiredError(name);
      }
      return tool.execute(params);
    },

    setGovernance(governance: GovernanceService): void {
      executionGovernance = governance;
    },

    getByRiskLevel(level: RiskLevel): Tool[] {
      return Array.from(tools.values()).filter(t => t.riskLevel === level);
    },
  };
}
