import { TestFailure } from '../types.js';

export interface ParserPlugin {
  name: string;
  canParse(stdout: string): boolean;
  parse(stdout: string, stderr: string): TestFailure[];
}

export interface ResultParser {
  parse(stdout: string, stderr: string, exitCode: number): TestFailure[];
  isPassed(exitCode: number): boolean;
}

// ── Jest Plugin ──

export const jestPlugin: ParserPlugin = {
  name: 'jest',

  canParse(stdout: string): boolean {
    // Jest output is identified by the ● character prefix on test failures
    return /●\s/.test(stdout);
  },

  parse(stdout: string, stderr: string): TestFailure[] {
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
};

// ── Vitest Plugin ──

export const vitestPlugin: ParserPlugin = {
  name: 'vitest',

  canParse(stdout: string): boolean {
    // Vitest output uses " FAIL " prefix for test failures
    return /^\s*FAIL\s+/m.test(stdout);
  },

  parse(stdout: string, stderr: string): TestFailure[] {
    const failures: TestFailure[] = [];
    const combined = stdout + '\n' + stderr;

    // Vitest failures: " FAIL  filePath > suite > test name"
    const failBlocks = combined.split(/(?=^\s*FAIL\s+)/m);

    for (const block of failBlocks) {
      if (!/^\s*FAIL\s+/.test(block)) continue;

      // Extract file path and test name from the FAIL line
      const failLineMatch = block.match(/^\s*FAIL\s+(.+?)\s*>\s*(.+)$/m);
      const file = failLineMatch ? failLineMatch[1].trim() : 'unknown';
      const testName = failLineMatch ? failLineMatch[2].trim() : block.trim().substring(0, 200);

      // Extract line number from Vitest's stack trace: ❯ file:line:col
      const lineMatch = block.match(/[❯>]\s*(.+?):(\d+):(\d+)/);
      const line = lineMatch ? parseInt(lineMatch[2], 10) : 0;

      // Extract diff from Vitest output: - Expected / + Received
      const expectedMatch = block.match(/^-\s+(.+)$/m);
      const receivedMatch = block.match(/^\+\s+(.+)$/m);
      const diff = expectedMatch && receivedMatch
        ? `Expected: ${expectedMatch[1].trim()}\nReceived: ${receivedMatch[1].trim()}`
        : block.trim().substring(0, 500);

      // Classify error type
      const type = detectFailureType(block);

      failures.push({
        file,
        line,
        type,
        message: testName,
        diff,
      });
    }

    return failures;
  },
};

// ── Default plugins ──

const DEFAULT_PLUGINS: ParserPlugin[] = [jestPlugin, vitestPlugin];

// ── Factory ──

export function createResultParser(plugins?: ParserPlugin[]): ResultParser {
  const activePlugins = plugins ?? DEFAULT_PLUGINS;

  return {
    parse(stdout: string, stderr: string, _exitCode: number): TestFailure[] {
      const combined = stdout + '\n' + stderr;
      for (const plugin of activePlugins) {
        if (plugin.canParse(combined)) {
          return plugin.parse(stdout, stderr);
        }
      }
      // No matching plugin — return empty array (no crash)
      return [];
    },

    isPassed(exitCode: number): boolean {
      return exitCode === 0;
    },
  };
}

// ── Failure type detection (shared) ──

function detectFailureType(text: string): TestFailure['type'] {
  if (/SyntaxError/i.test(text)) return 'syntax';
  if (/Timeout/i.test(text) || /exceeded.*timeout/i.test(text)) return 'timeout';
  if (/Expected|Received|expect\(|toBe\(|toEqual\(|toMatch/i.test(text)) return 'assertion';
  return 'runtime';
}