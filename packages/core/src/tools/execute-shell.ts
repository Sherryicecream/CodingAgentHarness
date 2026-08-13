import { Tool, ToolResult } from '../types.js';
import { exec, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

export const terminateWindowsProcessTree = async (
  pid: number,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> => {
  const systemRoot = environment.SystemRoot;
  if (!systemRoot || !win32.isAbsolute(systemRoot)) {
    throw new Error('Windows SystemRoot must be an absolute path');
  }
  const taskkillPath = win32.join(systemRoot, 'System32', 'taskkill.exe');
  if (!existsSync(taskkillPath)) {
    throw new Error(`Windows taskkill executable was not found under SystemRoot: ${taskkillPath}`);
  }

  await new Promise<void>((resolve, reject) => {
    const taskkill = spawn(taskkillPath, ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    taskkill.once('error', reject);
    taskkill.once('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`taskkill exited with code ${String(code)}`));
      }
    });
  });
};

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
        let timeoutHandle: NodeJS.Timeout | undefined;
        let timedOut = false;
        let termination = Promise.resolve();
        const child = exec(
          command,
          {
            cwd: workspaceRoot,
            ...(process.platform === 'win32' ? {} : { timeout }),
            maxBuffer: 1024 * 1024, // 1MB
          },
          (error, stdout, stderr) => {
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
            }
            // exitCode: 0 on success, the actual code on non-zero exit, and
            // null when the process was killed by a signal (timeout).
            const exitCode = error === null ? 0 : (error.code ?? null);
            const output = JSON.stringify({
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              exitCode,
            });
            void termination.then(
              () => resolve({
                success: !timedOut && (!error || error.code === 0),
                output,
                error: timedOut
                  ? `Command timed out after ${timeout}ms`
                  : error && error.code !== 0 ? error.message : undefined,
              }),
              (terminationError: unknown) => resolve({
                success: false,
                output,
                error: `Command timed out and process cleanup failed: ${String(terminationError)}`,
              }),
            );
          },
        );

        if (process.platform === 'win32') {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            termination = child.pid === undefined
              ? Promise.reject(new Error('Shell process did not expose a PID'))
              : terminateWindowsProcessTree(child.pid);
          }, timeout);
        }
      });
    },
  };
}
