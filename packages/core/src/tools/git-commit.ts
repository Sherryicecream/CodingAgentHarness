import { Tool, ToolResult } from '../types.js';
import { exec } from 'node:child_process';

export function createGitCommitTool(workspaceRoot: string): Tool {
  return {
    definition: {
      name: 'git_commit',
      description:
        'Stage all changes and create a git commit with the given message.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'The commit message.',
          },
        },
        required: ['message'],
      },
    },
    riskLevel: 'dangerous',

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const message = String(params.message ?? '');

      // Step 1: git add -A
      try {
        await new Promise<void>((resolve, reject) => {
          exec(
            'git add -A',
            {
              cwd: workspaceRoot,
              timeout: 15000,
              maxBuffer: 1024 * 1024,
            },
            (error, _stdout, stderr) => {
              if (error) {
                reject(new Error(stderr || error.message));
              } else {
                resolve();
              }
            },
          );
        });
      } catch (err: any) {
        return {
          success: false,
          output: err.message,
          error: err.message,
        };
      }

      // Step 2: git commit -m "message"
      // Use --allow-empty-message when the message is empty, since git
      // rejects empty commit messages by default on most versions.
      const allowEmptyFlag = message.trim() === '' ? '--allow-empty-message ' : '';

      return new Promise<ToolResult>((resolve) => {
        exec(
          `git commit ${allowEmptyFlag}-m "${message.replace(/"/g, '\\"')}"`,
          {
            cwd: workspaceRoot,
            timeout: 15000,
            maxBuffer: 1024 * 1024,
          },
          (error, stdout, stderr) => {
            if (error) {
              // git commit returns exit code 1 when there's nothing to commit
              const combined = (stdout + stderr).trim();
              if (/nothing to commit/i.test(combined)) {
                resolve({
                  success: true,
                  output: 'nothing to commit',
                });
              } else {
                resolve({
                  success: false,
                  output: combined,
                  error: error.message,
                });
              }
            } else {
              // Parse the commit hash from the output
              // Typical output: "[main <hash>] message" or "[main (root-commit) <hash>] message"
              const hashMatch = (stdout + stderr).match(
                /\[[\w\-./]+(?:\))?\s+([a-f0-9]{7,40})\]/,
              );
              const hash = hashMatch ? hashMatch[1] : '';
              resolve({
                success: true,
                output: `Committed: ${hash}`,
              });
            }
          },
        );
      });
    },
  };
}