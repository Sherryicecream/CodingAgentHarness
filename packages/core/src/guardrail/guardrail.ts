import { GuardrailDecision, RiskLevel, ToolCallRequest } from '../types.js';

export interface Guardrail {
  check(toolCall: ToolCallRequest, riskLevel?: RiskLevel): GuardrailDecision;
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
  // Only block destructive format commands (e.g., format C:, format D:)
  // but allow harmless uses like "npm run format" or "eslint --fix"
  { pattern: /\bformat\s+[a-z]:[/\\]/i, description: 'Disk format command' },
  { pattern: /\bmkfs\b/i, description: 'Make filesystem' },
  // Git-sensitive file writes (defense-in-depth: also checked in write_file tool)
  { pattern: /\.git\s*[\\/]\s*(config|HEAD|hooks|objects|refs)/i, description: 'Git repository file write' },
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
    check(toolCall: ToolCallRequest, riskLevel?: RiskLevel): GuardrailDecision {
      if (riskLevel === 'dangerous') {
        return 'blocked';
      }

      // Collect all string arguments to check for dangerous patterns
      const args = toolCall.arguments || {};
      const commandStr = args.command ? String(args.command) : '';
      const pathStr = args.path ? String(args.path) : '';
      const filePathStr = args.filePath ? String(args.filePath) : '';

      const combined = [commandStr, pathStr, filePathStr].join('\n');

      if (!combined.trim()) {
        return 'allowed';
      }

      for (const { pattern } of patterns) {
        if (pattern.test(combined)) {
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
