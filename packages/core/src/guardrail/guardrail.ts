import { GuardrailDecision, ToolCallRequest } from '../types.js';

export interface Guardrail {
  check(toolCall: ToolCallRequest): GuardrailDecision;
  addPattern(pattern: RegExp, description: string): void;
}

// Built-in dangerous patterns
const DEFAULT_PATTERNS: { pattern: RegExp; description: string }[] = [
  { pattern: /\brm\s+-rf?\b/i, description: 'Recursive file deletion' },
  { pattern: /\brmdir\b/i, description: 'Remove directory' },
  { pattern: /\bDROP\s+TABLE\b/i, description: 'SQL DROP TABLE' },
  { pattern: /\bDROP\s+DATABASE\b/i, description: 'SQL DROP DATABASE' },
  { pattern: /\bTRUNCATE\b/i, description: 'SQL TRUNCATE' },
  { pattern: /\bgit\s+push\s+.*--force\b/i, description: 'Git force push' },
  { pattern: /\bgit\s+push\s+.*-f\b/i, description: 'Git force push (short flag)' },
  { pattern: /\bnpm\s+publish\b/i, description: 'npm publish' },
  { pattern: /\byarn\s+publish\b/i, description: 'yarn publish' },
  { pattern: /\bchmod\s+777\b/i, description: 'World-writable permissions' },
  { pattern: />\s*\/dev\/sd[a-z]/i, description: 'Direct disk write' },
  { pattern: /\bdd\s+if=/i, description: 'dd disk copy' },
  { pattern: /\bformat\b/i, description: 'Format command' },
  { pattern: /\bmkfs\b/i, description: 'Make filesystem' },
];

export function createGuardrail(config?: { blockedCommands?: string[] }): Guardrail {
  const patterns = [...DEFAULT_PATTERNS];

  // Add custom blocked commands from config
  if (config?.blockedCommands) {
    for (const cmd of config.blockedCommands) {
      const escaped = cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      patterns.push({ pattern: new RegExp(escaped, 'i'), description: `Custom: ${cmd}` });
    }
  }

  return {
    check(toolCall: ToolCallRequest): GuardrailDecision {
      // Only check execute_shell and git_commit tools
      // For other tools, check the command argument if it exists
      const commandStr = toolCall.arguments?.command
        ? String(toolCall.arguments.command)
        : '';

      if (!commandStr) {
        return 'allowed';
      }

      for (const { pattern, description: _desc } of patterns) {
        if (pattern.test(commandStr)) {
          return 'blocked';
        }
      }

      return 'allowed';
    },

    addPattern(pattern: RegExp, description: string): void {
      patterns.push({ pattern, description });
    },
  };
}