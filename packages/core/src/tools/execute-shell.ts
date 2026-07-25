import { Tool, ToolResult } from '../types.js';
import { exec } from 'node:child_process';

export function createExecuteShellTool(
  workspaceRoot: string,
  options?: { timeout?: number },
): Tool {
  return {
    definition: {
      name: 'execute_shell',
      description:
        'Execute a shell command in the workspace directory. Returns stdout, stderr, and exit code.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute.',
          },
        },
        required: ['command'],
      },
    },
    riskLevel: 'moderate',

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const command = String(params.command);
      const timeout = options?.timeout ?? 30000; // 30s default

      return new Promise<ToolResult>((resolve) => {
        const child = exec(
          command,
          {
            cwd: workspaceRoot,
            timeout,
            maxBuffer: 1024 * 1024, // 1MB
          },
          (error, stdout, stderr) => {
            // exitCode: 0 on success, the actual code on non-zero exit, and
            // null when the process was killed by a signal (timeout).
            const exitCode = error === null ? 0 : (error.code ?? null);
            const output = JSON.stringify({
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              exitCode,
            });
            resolve({
              success: !error || error.code === 0,
              output,
              error: error && error.code !== 0 ? error.message : undefined,
            });
          },
        );
      });
    },
  };
}