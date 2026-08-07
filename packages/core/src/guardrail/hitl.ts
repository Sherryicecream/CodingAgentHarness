import { HITLState, ToolCallRequest } from '../types.js';

export interface HITLManager {
  state: HITLState;
  pendingAction: ToolCallRequest | null;
  requestApproval(action: ToolCallRequest): void;
  approve(): void;
  reject(): void;
  reset(): void;
}

export class HITLStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HITLStateError';
  }
}

export function createHITLManager(): HITLManager {
  let _state: HITLState = 'running';
  let _pendingAction: ToolCallRequest | null = null;

  return {
    get state(): HITLState {
      return _state;
    },

    get pendingAction(): ToolCallRequest | null {
      return _pendingAction;
    },

    requestApproval(action: ToolCallRequest): void {
      if (_state !== 'running') {
        throw new HITLStateError(`Cannot request approval in state: ${_state}`);
      }
      _pendingAction = action;
      _state = 'waiting_user';
    },

    approve(): void {
      if (_state !== 'waiting_user') {
        throw new HITLStateError(`Cannot approve in state: ${_state}`);
      }
      _state = 'approved';
    },

    reject(): void {
      if (_state !== 'waiting_user') {
        throw new HITLStateError(`Cannot reject in state: ${_state}`);
      }
      _state = 'rejected';
    },

    reset(): void {
      _state = 'running';
      _pendingAction = null;
    },
  };
}