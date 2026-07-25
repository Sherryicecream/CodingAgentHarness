import { Tool, ToolResult } from '../types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

export function createWriteFileTool(workspaceRoot: string): Tool {
  const resolvedRoot = path.resolve(workspaceRoot);

  return {
    definition: {
      name: 'write_file',
      description: 'Write content to a file. Creates parent directories if needed.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to workspace root.' },
          content: { type: 'string', description: 'Content to write.' },
        },
        required: ['path', 'content'],
      },
    },
    riskLevel: 'moderate',

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const filePath = String(params.path);
      const content = String(params.content);
      const resolved = path.resolve(resolvedRoot, filePath);

      // Prevent path traversal
      if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
        return { success: false, output: '', error: `Access denied: path outside workspace.` };
      }

      // Protect .git directory
      if (resolved.includes(path.sep + '.git' + path.sep) || resolved.endsWith(path.sep + '.git')) {
        return { success: false, output: '', error: `Access denied: cannot modify .git directory.` };
      }

      try {
        // Create parent directories
        const dir = path.dirname(resolved);
        fs.mkdirSync(dir, { recursive: true });

        // Write file
        fs.writeFileSync(resolved, content, 'utf-8');
        return { success: true, output: `File written: ${filePath}` };
      } catch (err: any) {
        return { success: false, output: '', error: `Failed to write file: ${err.message}` };
      }
    },
  };
}