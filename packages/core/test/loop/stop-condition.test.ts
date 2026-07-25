import { describe, it, expect } from 'vitest';
import { createStopCondition, StopCondition } from '../../src/loop/stop-condition.js';

describe('StopCondition', () => {
  let stopCondition: StopCondition;

  beforeEach(() => {
    stopCondition = createStopCondition();
  });

  describe('check', () => {
    it('should stop when task is complete and tests pass', () => {
      const result = stopCondition.check({
        isComplete: true,
        testPassed: true,
        currentIteration: 3,
        maxIterations: 20,
        hitlState: 'running',
      });

      expect(result.shouldStop).toBe(true);
      expect(result.reason).toBe('task_complete');
    });

    it('should not stop when task is complete but tests fail', () => {
      const result = stopCondition.check({
        isComplete: true,
        testPassed: false,
        currentIteration: 3,
        maxIterations: 20,
        hitlState: 'running',
      });

      expect(result.shouldStop).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('should stop when max iterations reached', () => {
      const result = stopCondition.check({
        isComplete: false,
        testPassed: false,
        currentIteration: 20,
        maxIterations: 20,
        hitlState: 'running',
      });

      expect(result.shouldStop).toBe(true);
      expect(result.reason).toBe('max_iterations');
    });

    it('should stop when HITL is waiting for user', () => {
      const result = stopCondition.check({
        isComplete: false,
        testPassed: false,
        currentIteration: 5,
        maxIterations: 20,
        hitlState: 'waiting_user',
      });

      expect(result.shouldStop).toBe(true);
      expect(result.reason).toBe('blocked_waiting');
    });

    it('should not stop during normal execution', () => {
      const result = stopCondition.check({
        isComplete: false,
        testPassed: false,
        currentIteration: 5,
        maxIterations: 20,
        hitlState: 'running',
      });

      expect(result.shouldStop).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('should stop when max iterations exceeded', () => {
      const result = stopCondition.check({
        isComplete: false,
        testPassed: false,
        currentIteration: 25,
        maxIterations: 20,
        hitlState: 'running',
      });

      expect(result.shouldStop).toBe(true);
      expect(result.reason).toBe('max_iterations');
    });

    it('should prioritize blocked_waiting over other conditions', () => {
      // Even if complete and tests pass, waiting_user should take priority
      const result = stopCondition.check({
        isComplete: true,
        testPassed: true,
        currentIteration: 3,
        maxIterations: 20,
        hitlState: 'waiting_user',
      });

      expect(result.shouldStop).toBe(true);
      expect(result.reason).toBe('blocked_waiting');
    });
  });
});