import { TestFailure } from '../types.js';

export interface ResultParser {
  parse(stdout: string, stderr: string, exitCode: number): TestFailure[];
  isPassed(exitCode: number): boolean;
}

export function createResultParser(): ResultParser {
  return {
    parse(stdout: string, stderr: string, _exitCode: number): TestFailure[] {
      const failures: TestFailure[] = [];
      const combined = stdout + '\n' + stderr;

      // Parse Jest-style failures: ● test name
      const testBlocks = combined.split(/(?=●\s)/);

      for (const block of testBlocks) {
        if (!block.startsWith('●')) continue;

        // Extract file and line: at Object.<anonymous> (path:line:col)
        const fileMatch = block.match(/at\s+(?:Object\.<anonymous>|[\w.]+)\s+\(([^)]+):(\d+):(\d+)\)/);
        const file = fileMatch ? fileMatch[1] : 'unknown';
        const line = fileMatch ? parseInt(fileMatch[2], 10) : 0;

        // Extract Expected / Received diff
        const expectedMatch = block.match(/Expected:\s*(.+?)(?:\n|Received:)/s);
        const receivedMatch = block.match(/Received:\s*(.+?)(?:\n|$)/s);
        const diff = expectedMatch && receivedMatch
          ? `Expected: ${expectedMatch[1].trim()}\nReceived: ${receivedMatch[1].trim()}`
          : block.trim().substring(0, 500);

        // Classify error type
        const type = detectFailureType(block);

        // Extract the test name (first line after ●)
        const nameMatch = block.match(/●\s+(.+)/);
        const message = nameMatch ? nameMatch[1].trim() : block.trim().substring(0, 200);

        failures.push({ file, line, type, message, diff });
      }

      return failures;
    },

    isPassed(exitCode: number): boolean {
      return exitCode === 0;
    },
  };
}

function detectFailureType(text: string): TestFailure['type'] {
  if (/SyntaxError/i.test(text)) return 'syntax';
  if (/Timeout/i.test(text) || /exceeded.*timeout/i.test(text)) return 'timeout';
  if (/Expected|Received|expect\(|toBe\(|toEqual\(|toMatch/i.test(text)) return 'assertion';
  return 'runtime';
}