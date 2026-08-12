import { describe, it, expect } from 'vitest';
import { Tool, ToolResult } from '../../src/types.js';
import { createGovernanceService } from '../../src/guardrail/index.js';
import { createToolRegistry, ToolApprovalRequiredError, ToolNotFoundError } from '../../src/tools/tool.js';

function makeMockTool(
  name: string,
  riskLevel: 'safe' | 'moderate' | 'dangerous' = 'safe',
): Tool {
  return {
    definition: {
      name,
      description: `Tool: ${name}`,
      parameters: { type: 'object', properties: {} },
    },
    execute: async (params: Record<string, unknown>): Promise<ToolResult> => ({
      success: true,
      output: JSON.stringify(params),
    }),
    riskLevel,
  };
}

describe('ToolRegistry', () => {
  describe('register and get', () => {
    it('should register a tool and retrieve it by name', () => {
      const registry = createToolRegistry();
      const tool = makeMockTool('test_tool');
      registry.register(tool);
      expect(registry.get('test_tool')).toBe(tool);
    });

    it('should return undefined for unregistered tool name', () => {
      const registry = createToolRegistry();
      expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('should overwrite a tool when registering with the same name', () => {
      const registry = createToolRegistry();
      const first = makeMockTool('duplicate', 'safe');
      const second = makeMockTool('duplicate', 'dangerous');
      registry.register(first);
      registry.register(second);
      expect(registry.get('duplicate')).toBe(second);
      expect(registry.get('duplicate')?.riskLevel).toBe('dangerous');
    });
  });

  describe('execute', () => {
    it('should execute a registered tool and return the correct result', async () => {
      const registry = createToolRegistry();
      const tool = makeMockTool('echo');
      registry.register(tool);

      const result = await registry.execute('echo', { key: 'value' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('{"key":"value"}');
    });

    it('should throw ToolNotFoundError when executing an unregistered tool', async () => {
      const registry = createToolRegistry();
      await expect(
        registry.execute('nonexistent', {}),
      ).rejects.toThrow(ToolNotFoundError);
    });

    it('should propagate errors from the tool execution', async () => {
      const registry = createToolRegistry();
      const failingTool: Tool = {
        definition: {
          name: 'failer',
          description: 'Always fails',
          parameters: { type: 'object', properties: {} },
        },
        execute: async () => {
          throw new Error('execution failure');
        },
        riskLevel: 'safe',
      };
      registry.register(failingTool);

      await expect(
        registry.execute('failer', {}),
      ).rejects.toThrow('execution failure');
    });

    it('should request approval before executing a dangerous tool with a harmless command', async () => {
      const governance = createGovernanceService();
      const registry = createToolRegistry(governance);
      let executions = 0;
      registry.register({
        ...makeMockTool('dangerous_echo', 'dangerous'),
        async execute(): Promise<ToolResult> {
          executions += 1;
          return { success: true, output: 'hello' };
        },
      });

      await expect(registry.execute(
        'dangerous_echo',
        { command: 'echo hello' },
        { toolCallId: 'dangerous_echo_1' },
      )).rejects.toThrow(ToolApprovalRequiredError);

      expect(executions).toBe(0);
      expect(governance.hitl.state).toBe('waiting_user');
      expect(governance.hitl.pendingAction).toEqual({
        id: 'dangerous_echo_1',
        name: 'dangerous_echo',
        arguments: { command: 'echo hello' },
      });
    });

    it('should require approval by default before executing a dangerous tool', async () => {
      const registry = createToolRegistry();
      let executions = 0;
      registry.register({
        ...makeMockTool('dangerous_echo_default', 'dangerous'),
        async execute(): Promise<ToolResult> {
          executions += 1;
          return { success: true, output: 'hello' };
        },
      });

      await expect(registry.execute(
        'dangerous_echo_default',
        { command: 'echo hello' },
      )).rejects.toThrow(ToolApprovalRequiredError);

      expect(executions).toBe(0);
    });
  });

  describe('list', () => {
    it('should return an empty list when no tools are registered', () => {
      const registry = createToolRegistry();
      expect(registry.list()).toEqual([]);
    });

    it('should return all registered tool definitions', () => {
      const registry = createToolRegistry();
      registry.register(makeMockTool('tool_a'));
      registry.register(makeMockTool('tool_b'));
      registry.register(makeMockTool('tool_c'));

      const definitions = registry.list();
      expect(definitions).toHaveLength(3);
      expect(definitions.map(d => d.name)).toEqual(['tool_a', 'tool_b', 'tool_c']);
    });
  });

  describe('getByRiskLevel', () => {
    it('should return only dangerous tools', () => {
      const registry = createToolRegistry();
      registry.register(makeMockTool('safe_tool', 'safe'));
      registry.register(makeMockTool('dangerous_tool', 'dangerous'));
      registry.register(makeMockTool('moderate_tool', 'moderate'));

      const dangerous = registry.getByRiskLevel('dangerous');
      expect(dangerous).toHaveLength(1);
      expect(dangerous[0].definition.name).toBe('dangerous_tool');
    });

    it('should return only safe tools', () => {
      const registry = createToolRegistry();
      registry.register(makeMockTool('safe_a', 'safe'));
      registry.register(makeMockTool('safe_b', 'safe'));
      registry.register(makeMockTool('dangerous_tool', 'dangerous'));
      registry.register(makeMockTool('moderate_tool', 'moderate'));

      const safe = registry.getByRiskLevel('safe');
      expect(safe).toHaveLength(2);
      expect(safe.map(t => t.definition.name)).toEqual(['safe_a', 'safe_b']);
    });

    it('should return an empty array when no tools match the risk level', () => {
      const registry = createToolRegistry();
      registry.register(makeMockTool('safe_tool', 'safe'));

      const dangerous = registry.getByRiskLevel('dangerous');
      expect(dangerous).toEqual([]);
    });
  });
});
