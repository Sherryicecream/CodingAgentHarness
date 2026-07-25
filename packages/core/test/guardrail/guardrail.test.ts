import { describe, it, expect } from 'vitest';
import { createGuardrail } from '../../src/guardrail/guardrail.js';

describe('Guardrail', () => {
  // 1. rm -rf / -> blocked
  it('should block "rm -rf /"', () => {
    const guardrail = createGuardrail();
    const result = guardrail.check({
      id: '1',
      name: 'execute_shell',
      arguments: { command: 'rm -rf /' },
    });
    expect(result).toBe('blocked');
  });

  // 2. echo hello -> allowed
  it('should allow "echo hello"', () => {
    const guardrail = createGuardrail();
    const result = guardrail.check({
      id: '2',
      name: 'execute_shell',
      arguments: { command: 'echo hello' },
    });
    expect(result).toBe('allowed');
  });

  // 3. DROP TABLE users -> blocked
  it('should block "DROP TABLE users"', () => {
    const guardrail = createGuardrail();
    const result = guardrail.check({
      id: '3',
      name: 'execute_shell',
      arguments: { command: 'DROP TABLE users' },
    });
    expect(result).toBe('blocked');
  });

  // 4. git push --force origin main -> blocked
  it('should block "git push --force origin main"', () => {
    const guardrail = createGuardrail();
    const result = guardrail.check({
      id: '4',
      name: 'execute_shell',
      arguments: { command: 'git push --force origin main' },
    });
    expect(result).toBe('blocked');
  });

  // 5. npm publish -> blocked
  it('should block "npm publish"', () => {
    const guardrail = createGuardrail();
    const result = guardrail.check({
      id: '5',
      name: 'execute_shell',
      arguments: { command: 'npm publish' },
    });
    expect(result).toBe('blocked');
  });

  // 6. chmod 777 file -> blocked
  it('should block "chmod 777 file"', () => {
    const guardrail = createGuardrail();
    const result = guardrail.check({
      id: '6',
      name: 'execute_shell',
      arguments: { command: 'chmod 777 file' },
    });
    expect(result).toBe('blocked');
  });

  // 7. Custom pattern added via addPattern() -> blocked
  it('should block command matching a custom pattern added via addPattern()', () => {
    const guardrail = createGuardrail();
    guardrail.addPattern(/\bsudo\s+shutdown\b/i, 'System shutdown');
    const result = guardrail.check({
      id: '7',
      name: 'execute_shell',
      arguments: { command: 'sudo shutdown now' },
    });
    expect(result).toBe('blocked');
  });

  // 8. Case-insensitive matching (RM -RF) -> blocked
  it('should block case-insensitive match "RM -RF"', () => {
    const guardrail = createGuardrail();
    const result = guardrail.check({
      id: '8',
      name: 'execute_shell',
      arguments: { command: 'RM -RF /usr' },
    });
    expect(result).toBe('blocked');
  });

  // 9. Empty command -> allowed
  it('should allow empty command', () => {
    const guardrail = createGuardrail();
    const result = guardrail.check({
      id: '9',
      name: 'execute_shell',
      arguments: { command: '' },
    });
    expect(result).toBe('allowed');
  });

  // 10. Non-shell tool call (no command arg) -> allowed
  it('should allow non-shell tool call with no command argument', () => {
    const guardrail = createGuardrail();
    const result = guardrail.check({
      id: '10',
      name: 'read_file',
      arguments: { path: '/some/file.txt' },
    });
    expect(result).toBe('allowed');
  });

  // Additional tests for broader coverage
  it('should block "DROP DATABASE production"', () => {
    const guardrail = createGuardrail();
    const result = guardrail.check({
      id: '11',
      name: 'execute_shell',
      arguments: { command: 'DROP DATABASE production' },
    });
    expect(result).toBe('blocked');
  });

  it('should block "TRUNCATE TABLE orders"', () => {
    const guardrail = createGuardrail();
    const result = guardrail.check({
      id: '12',
      name: 'execute_shell',
      arguments: { command: 'TRUNCATE TABLE orders' },
    });
    expect(result).toBe('blocked');
  });

  it('should block "git push -f origin main"', () => {
    const guardrail = createGuardrail();
    const result = guardrail.check({
      id: '13',
      name: 'execute_shell',
      arguments: { command: 'git push -f origin main' },
    });
    expect(result).toBe('blocked');
  });

  it('should block "yarn publish"', () => {
    const guardrail = createGuardrail();
    const result = guardrail.check({
      id: '14',
      name: 'execute_shell',
      arguments: { command: 'yarn publish' },
    });
    expect(result).toBe('blocked');
  });

  it('should block "dd if=/dev/zero"', () => {
    const guardrail = createGuardrail();
    const result = guardrail.check({
      id: '15',
      name: 'execute_shell',
      arguments: { command: 'dd if=/dev/zero of=output' },
    });
    expect(result).toBe('blocked');
  });

  it('should block "rmdir /important"', () => {
    const guardrail = createGuardrail();
    const result = guardrail.check({
      id: '16',
      name: 'execute_shell',
      arguments: { command: 'rmdir /important' },
    });
    expect(result).toBe('blocked');
  });

  it('should allow safe commands like "ls -la"', () => {
    const guardrail = createGuardrail();
    const result = guardrail.check({
      id: '17',
      name: 'execute_shell',
      arguments: { command: 'ls -la' },
    });
    expect(result).toBe('allowed');
  });

  it('should allow safe commands like "npm test"', () => {
    const guardrail = createGuardrail();
    const result = guardrail.check({
      id: '18',
      name: 'execute_shell',
      arguments: { command: 'npm test' },
    });
    expect(result).toBe('allowed');
  });

  it('should block commands matching custom blockedCommands config', () => {
    const guardrail = createGuardrail({ blockedCommands: ['kubectl delete'] });
    const result = guardrail.check({
      id: '19',
      name: 'execute_shell',
      arguments: { command: 'kubectl delete pod myapp' },
    });
    expect(result).toBe('blocked');
  });
});