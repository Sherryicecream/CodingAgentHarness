import { describe, it, expect } from 'vitest';
import { createHITLManager, HITLStateError } from '../../src/guardrail/hitl.js';

describe('HITL State Machine', () => {
  // 1. Initial state is running, pendingAction is null
  it('should have initial state "running" with null pendingAction', () => {
    const hitl = createHITLManager();
    expect(hitl.state).toBe('running');
    expect(hitl.pendingAction).toBeNull();
  });

  // 2. requestApproval() -> state becomes waiting_user, pendingAction is set
  it('should transition to "waiting_user" and set pendingAction on requestApproval()', () => {
    const hitl = createHITLManager();
    const action = { id: '1', name: 'execute_shell', arguments: { command: 'rm -rf /' } };
    hitl.requestApproval(action);
    expect(hitl.state).toBe('waiting_user');
    expect(hitl.pendingAction).toEqual(action);
  });

  // 3. approve() -> state becomes approved
  it('should transition to "approved" on approve()', () => {
    const hitl = createHITLManager();
    hitl.requestApproval({ id: '1', name: 'execute_shell', arguments: { command: 'rm -rf /' } });
    hitl.approve();
    expect(hitl.state).toBe('approved');
  });

  // 4. reject() -> state becomes rejected
  it('should transition to "rejected" on reject()', () => {
    const hitl = createHITLManager();
    hitl.requestApproval({ id: '2', name: 'execute_shell', arguments: { command: 'DROP TABLE users' } });
    hitl.reject();
    expect(hitl.state).toBe('rejected');
  });

  // 5. reset() -> state back to running, pendingAction cleared
  it('should reset state to "running" and clear pendingAction', () => {
    const hitl = createHITLManager();
    hitl.requestApproval({ id: '3', name: 'execute_shell', arguments: { command: 'chmod 777 file' } });
    hitl.approve();
    hitl.reset();
    expect(hitl.state).toBe('running');
    expect(hitl.pendingAction).toBeNull();
  });

  // 6. approve() when not in waiting_user -> throws HITLStateError
  it('should throw HITLStateError when approve() is called outside "waiting_user"', () => {
    const hitl = createHITLManager();
    expect(() => hitl.approve()).toThrow(HITLStateError);
    expect(() => hitl.approve()).toThrow('Cannot approve in state: running');
  });

  // 7. reject() when not in waiting_user -> throws HITLStateError
  it('should throw HITLStateError when reject() is called outside "waiting_user"', () => {
    const hitl = createHITLManager();
    expect(() => hitl.reject()).toThrow(HITLStateError);
    expect(() => hitl.reject()).toThrow('Cannot reject in state: running');
  });

  // 8. requestApproval() when not in running -> throws HITLStateError
  it('should throw HITLStateError when requestApproval() is called outside "running"', () => {
    const hitl = createHITLManager();
    const action = { id: '4', name: 'execute_shell', arguments: { command: 'rm -rf /' } };
    hitl.requestApproval(action); // now in waiting_user
    hitl.approve(); // now in approved
    expect(() => hitl.requestApproval(action)).toThrow(HITLStateError);
    expect(() => hitl.requestApproval(action)).toThrow('Cannot request approval in state: approved');
  });

  // 9. Full flow: requestApproval -> approve -> reset -> state is running
  it('should complete full flow: requestApproval -> approve -> reset', () => {
    const hitl = createHITLManager();
    const action = { id: '5', name: 'execute_shell', arguments: { command: 'npm publish' } };

    expect(hitl.state).toBe('running');

    hitl.requestApproval(action);
    expect(hitl.state).toBe('waiting_user');
    expect(hitl.pendingAction).toEqual(action);

    hitl.approve();
    expect(hitl.state).toBe('approved');

    hitl.reset();
    expect(hitl.state).toBe('running');
    expect(hitl.pendingAction).toBeNull();
  });

  // Additional: reject() should also throw after approve() has been called
  it('should throw HITLStateError when reject() is called after approve()', () => {
    const hitl = createHITLManager();
    hitl.requestApproval({ id: '6', name: 'execute_shell', arguments: { command: 'rm -rf /' } });
    hitl.approve();
    expect(() => hitl.reject()).toThrow(HITLStateError);
  });

  // Additional: approve() should throw after reject() has been called
  it('should throw HITLStateError when approve() is called after reject()', () => {
    const hitl = createHITLManager();
    hitl.requestApproval({ id: '7', name: 'execute_shell', arguments: { command: 'rm -rf /' } });
    hitl.reject();
    expect(() => hitl.approve()).toThrow(HITLStateError);
  });

  // Additional: reset from rejected state
  it('should reset to "running" from "rejected" state', () => {
    const hitl = createHITLManager();
    hitl.requestApproval({ id: '8', name: 'execute_shell', arguments: { command: 'rm -rf /' } });
    hitl.reject();
    expect(hitl.state).toBe('rejected');
    hitl.reset();
    expect(hitl.state).toBe('running');
    expect(hitl.pendingAction).toBeNull();
  });
});