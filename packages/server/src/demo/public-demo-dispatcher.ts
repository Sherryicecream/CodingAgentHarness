import { createToolRegistry, type ToolRegistry } from '../../../core/src/tools/tool.js';
import type { Tool } from '../../../core/src/types.js';
import type { WorkspaceManager } from '../session/workspace-manager.js';

export const createPublicDemoToolRegistry = (
  workspaceManager: WorkspaceManager,
  sessionId: string,
): ToolRegistry => {
  const registry = createToolRegistry();
  const writeFile: Tool = {
    definition: {
      name: 'write_file',
      description: 'Write a deterministic demo file inside the issued workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
    riskLevel: 'moderate',
    async execute(parameters) {
      if (typeof parameters.path !== 'string' || typeof parameters.content !== 'string') {
        return { success: false, output: '', error: 'INVALID_WRITE_ARGUMENTS' };
      }
      try {
        await workspaceManager.writeIssuedFile(
          sessionId,
          parameters.path,
          parameters.content,
        );
        return { success: true, output: `File written: ${parameters.path}` };
      } catch {
        return { success: false, output: '', error: 'WORKSPACE_WRITE_REJECTED' };
      }
    },
  };
  registry.register(writeFile);
  return registry;
};
