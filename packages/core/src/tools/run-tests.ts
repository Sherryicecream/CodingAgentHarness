import { Tool, ToolResult } from '../types.js';
import { exec } from 'node:child_process';

export function createRunTestsTool(
  workspaceRoot: string,
  options?: { command?: string },
): Tool {
  const defaultCommand = options?.command ?? 'npm test';

  return {
    definition: {
      name: 'run_tests',
      description: 'Run the project test suite. Returns test results including pass/fail status.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: `Optional test command. Defaults to: ${defaultCommand}`,
          },
        },
        required: [],
      },
    },
    riskLevel: 'safe',

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const command = String(params.command ?? defaultCommand);

      return new Promise<ToolResult>((resolve) => {
        exec(
          command,
          {
            cwd: workspaceRoot,
            timeout: 60000, // 60s for test suites
            maxBuffer: 5 * 1024 * 1024, // 5MB for test output
          },
          (error, stdout, stderr) => {
            const exitCode = error?.code ?? 0;
            const output = JSON.stringify({
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              exitCode,
            });
            resolve({
              success: exitCode === 0,
              output,
              error:
                exitCode !== 0 ? `Tests failed with exit code ${exitCode}` : undefined,
            });
          },
        );
      });
    },
  };
}