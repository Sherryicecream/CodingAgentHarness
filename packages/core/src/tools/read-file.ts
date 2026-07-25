import { Tool, ToolResult } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

export function createReadFileTool(workspaceRoot: string): Tool {
  const resolvedRoot = path.resolve(workspaceRoot);

  return {
    definition: {
      name: 'read_file',
      description: 'Read the contents of a file. Returns the file content as a string.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to the file to read, relative to the workspace root.',
          },
        },
        required: ['path'],
      },
    },
    riskLevel: 'safe',

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const filePath = String(params.path);
      const resolved = path.resolve(resolvedRoot, filePath);

      // Prevent path traversal
      if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
        return {
          success: false,
          output: '',
          error: `Access denied: path is outside workspace root. Requested: ${filePath}`,
        };
      }

      try {
        const content = fs.readFileSync(resolved, 'utf-8');
        return { success: true, output: content };
      } catch (err: any) {
        return {
          success: false,
          output: '',
          error: `Failed to read file: ${err.message}`,
        };
      }
    },
  };
}