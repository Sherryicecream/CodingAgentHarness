import { Tool, ToolResult } from '../types.js';
import { exec } from 'node:child_process';

export function createGitDiffTool(workspaceRoot: string): Tool {
  return {
    definition: {
      name: 'git_diff',
      description:
        'Execute git diff and return the output. Shows unstaged changes by default, or staged changes when staged=true.',
      parameters: {
        type: 'object',
        properties: {
          staged: {
            type: 'boolean',
            description: 'If true, show staged changes (git diff --cached).',
          },
        },
        required: [],
      },
    },
    riskLevel: 'safe',

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const staged = Boolean(params.staged);
      const args = staged ? 'diff --cached' : 'diff';

      return new Promise<ToolResult>((resolve) => {
        exec(
          `git ${args}`,
          {
            cwd: workspaceRoot,
            timeout: 15000,
            maxBuffer: 1024 * 1024, // 1MB
          },
          (error, stdout, stderr) => {
            if (error) {
              // git diff returns exit code 1 when there are differences
              // and exit code 128 when there's an error (e.g. not a git repo)
              if (error.code === 1) {
                // Exit code 1 means there are differences — that's normal
                resolve({
                  success: true,
                  output: stdout,
                });
              } else {
                // Exit code 128 or other errors indicate a real problem
                resolve({
                  success: false,
                  output: stdout || stderr || '',
                  error: error.message,
                });
              }
            } else if (stderr && /not a git repository/i.test(stderr)) {
              // On some platforms, git diff may exit 0 but write the error
              // to stderr when not in a git repository
              resolve({
                success: false,
                output: stderr,
                error: stderr.trim(),
              });
            } else {
              // Exit code 0 means no differences
              resolve({
                success: true,
                output: stdout,
              });
            }
          },
        );
      });
    },
  };
}