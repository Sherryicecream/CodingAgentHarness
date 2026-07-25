import { exec } from 'node:child_process';

export interface TestRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface TestRunner {
  run(workingDir: string, command?: string): Promise<TestRunResult>;
}

export function createTestRunner(): TestRunner {
  return {
    run(workingDir: string, command?: string): Promise<TestRunResult> {
      const cmd = command ?? 'npm test';
      const startTime = Date.now();

      return new Promise((resolve) => {
        exec(cmd, {
          cwd: workingDir,
          timeout: 60000,
          maxBuffer: 5 * 1024 * 1024,
        }, (error, stdout, stderr) => {
          resolve({
            exitCode: typeof error?.code === 'number' ? error.code : 0,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            durationMs: Date.now() - startTime,
          });
        });
      });
    },
  };
}