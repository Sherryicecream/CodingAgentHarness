export type StopReason = 'task_complete' | 'max_iterations' | 'user_terminated' | 'blocked_waiting';

export interface StopCondition {
  check(options: {
    isComplete: boolean;
    testPassed: boolean;
    currentIteration: number;
    maxIterations: number;
    hitlState: string;
  }): { shouldStop: boolean; reason: StopReason | null };
}

export function createStopCondition(): StopCondition {
  return {
    check({ isComplete, testPassed, currentIteration, maxIterations, hitlState }) {
      if (hitlState === 'waiting_user') {
        return { shouldStop: true, reason: 'blocked_waiting' };
      }
      if (isComplete && testPassed) {
        return { shouldStop: true, reason: 'task_complete' };
      }
      if (currentIteration >= maxIterations) {
        return { shouldStop: true, reason: 'max_iterations' };
      }
      return { shouldStop: false, reason: null };
    },
  };
}