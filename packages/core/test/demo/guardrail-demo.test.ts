import { describe, it, expect } from 'vitest';
import { createGovernanceService } from '../../src/guardrail/index.js';

describe('Guardrail Demo (机制演示 ①)', () => {
  it('should intercept dangerous command and require user approval', () => {
    const governance = createGovernanceService();

    // Simulate: LLM returns a tool call to execute "rm -rf /"
    const dangerousCall = {
      id: 'call_1',
      name: 'execute_shell',
      arguments: { command: 'rm -rf /' },
    };

    // Pre-check blocks it
    const allowed = governance.preCheck(dangerousCall);
    expect(allowed).toBe(false);
    expect(governance.hitl.state).toBe('waiting_user');
    expect(governance.hitl.pendingAction).toEqual(dangerousCall);

    // User approves
    governance.hitl.approve();
    expect(governance.hitl.state).toBe('approved');

    // Reset for next cycle
    governance.hitl.reset();
    expect(governance.hitl.state).toBe('running');
  });

  it('should allow safe commands through', () => {
    const governance = createGovernanceService();

    const safeCall = {
      id: 'call_1',
      name: 'execute_shell',
      arguments: { command: 'echo hello' },
    };

    const allowed = governance.preCheck(safeCall);
    expect(allowed).toBe(true);
    expect(governance.hitl.state).toBe('running');
  });
});