import { describe, it, expect } from 'vitest';
import { createGovernanceService } from '../../src/guardrail/index.js';

describe('GovernanceService Integration', () => {
  // 1. Safe command → preCheck returns true, hitl.state stays running
  it('should allow safe commands through preCheck without changing hitl state', () => {
    const governance = createGovernanceService();

    const safeCall = {
      id: 'call_1',
      name: 'execute_shell',
      arguments: { command: 'echo hello' },
    };

    const allowed = governance.preCheck(safeCall);
    expect(allowed).toBe(true);
    expect(governance.hitl.state).toBe('running');
    expect(governance.hitl.pendingAction).toBeNull();
  });

  // 2. Dangerous command → preCheck returns false, hitl.state becomes waiting_user
  it('should block a dangerous tool with a harmless command and request approval', () => {
    const governance = createGovernanceService();
    const dangerousToolCall = {
      id: 'call_dangerous_tool',
      name: 'dangerous_echo',
      arguments: { command: 'echo hello' },
    };

    const allowed = governance.preCheck(dangerousToolCall, 'dangerous');

    expect(allowed).toBe(false);
    expect(governance.hitl.state).toBe('waiting_user');
    expect(governance.hitl.pendingAction).toEqual(dangerousToolCall);
  });

  it('should block dangerous commands and set hitl to waiting_user', () => {
    const governance = createGovernanceService();

    const dangerousCall = {
      id: 'call_2',
      name: 'execute_shell',
      arguments: { command: 'rm -rf /' },
    };

    const allowed = governance.preCheck(dangerousCall);
    expect(allowed).toBe(false);
    expect(governance.hitl.state).toBe('waiting_user');
    expect(governance.hitl.pendingAction).toEqual(dangerousCall);
  });

  // 3. After approve + reset → preCheck for same command blocks again (new cycle)
  it('should block the same command again after approve + reset (new cycle)', () => {
    const governance = createGovernanceService();

    const dangerousCall = {
      id: 'call_3',
      name: 'execute_shell',
      arguments: { command: 'rm -rf /' },
    };

    // First cycle: block
    governance.preCheck(dangerousCall);
    expect(governance.hitl.state).toBe('waiting_user');

    // User approves
    governance.hitl.approve();
    expect(governance.hitl.state).toBe('approved');

    // Reset for new cycle
    governance.hitl.reset();
    expect(governance.hitl.state).toBe('running');
    expect(governance.hitl.pendingAction).toBeNull();

    // Second cycle: same command should be blocked again
    const allowedAgain = governance.preCheck(dangerousCall);
    expect(allowedAgain).toBe(false);
    expect(governance.hitl.state).toBe('waiting_user');
    expect(governance.hitl.pendingAction).toEqual(dangerousCall);
  });

  // 4. After reject → hitl.state is rejected
  it('should set hitl state to rejected after rejecting a dangerous command', () => {
    const governance = createGovernanceService();

    const dangerousCall = {
      id: 'call_4',
      name: 'execute_shell',
      arguments: { command: 'DROP TABLE users' },
    };

    governance.preCheck(dangerousCall);
    expect(governance.hitl.state).toBe('waiting_user');

    governance.hitl.reject();
    expect(governance.hitl.state).toBe('rejected');
  });

  // 5. postCheck always returns true
  it('should always return true from postCheck', () => {
    const governance = createGovernanceService();

    const anyCall = {
      id: 'call_5',
      name: 'execute_shell',
      arguments: { command: 'rm -rf /' },
    };

    expect(governance.postCheck(anyCall)).toBe(true);

    const safeCall = {
      id: 'call_6',
      name: 'read_file',
      arguments: { path: '/some/file.txt' },
    };

    expect(governance.postCheck(safeCall)).toBe(true);
  });

  // 6. Custom blockedCommands from config
  it('should use custom blockedCommands from config', () => {
    const governance = createGovernanceService({
      blockedCommands: ['kubectl delete'],
    });

    const customDangerousCall = {
      id: 'call_7',
      name: 'execute_shell',
      arguments: { command: 'kubectl delete pod myapp' },
    };

    const allowed = governance.preCheck(customDangerousCall);
    expect(allowed).toBe(false);
    expect(governance.hitl.state).toBe('waiting_user');
  });

  // 7. Non-shell tool calls should pass through
  it('should allow non-shell tool calls through preCheck', () => {
    const governance = createGovernanceService();

    const readFileCall = {
      id: 'call_8',
      name: 'read_file',
      arguments: { path: '/some/file.txt' },
    };

    const allowed = governance.preCheck(readFileCall);
    expect(allowed).toBe(true);
    expect(governance.hitl.state).toBe('running');
  });
});
