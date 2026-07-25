import { Tool, ToolDefinition, ToolResult, RiskLevel } from '../types.js';

export class ToolNotFoundError extends Error {
  constructor(name: string) {
    super(`Tool not found: ${name}`);
    this.name = 'ToolNotFoundError';
  }
}

export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): ToolDefinition[];
  execute(name: string, params: Record<string, unknown>): Promise<ToolResult>;
  getByRiskLevel(level: RiskLevel): Tool[];
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, Tool>();

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

    async execute(name: string, params: Record<string, unknown>): Promise<ToolResult> {
      const tool = tools.get(name);
      if (!tool) {
        throw new ToolNotFoundError(name);
      }
      return tool.execute(params);
    },

    getByRiskLevel(level: RiskLevel): Tool[] {
      return Array.from(tools.values()).filter(t => t.riskLevel === level);
    },
  };
}