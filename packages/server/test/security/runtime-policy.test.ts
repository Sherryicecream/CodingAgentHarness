import { describe, expect, it } from 'vitest';
import { resolveRuntimePolicy } from '../../src/security/runtime-policy.js';

describe('resolveRuntimePolicy', () => {
  it.each([undefined, '', 'unexpected'])('fails closed to the public policy for %j', (value) => {
    const policy = resolveRuntimePolicy(value);

    expect(policy).toMatchObject({
      mode: 'public',
      allowServerCredentials: false,
      allowByok: false,
      allowProcessTools: false,
      allowHttpByok: false,
      allowedExperiences: ['demo'],
    });
  });

  it('permits only the demo experience in public mode', () => {
    const policy = resolveRuntimePolicy('public');

    expect(policy.allowServerCredentials).toBe(false);
    expect(policy.allowByok).toBe(false);
    expect(policy.allowProcessTools).toBe(false);
    expect(policy.allowHttpByok).toBe(false);
    expect(policy.allowedExperiences).toEqual(['demo']);
  });

  it('permits the complete trusted capability set in local mode', () => {
    const policy = resolveRuntimePolicy('local');

    expect(policy).toEqual({
      mode: 'local',
      allowServerCredentials: true,
      allowByok: true,
      allowProcessTools: true,
      allowHttpByok: false,
      allowedExperiences: ['demo', 'byok', 'server'],
    });
  });

  it('returns immutable policy values', () => {
    const policy = resolveRuntimePolicy('public');

    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.allowedExperiences)).toBe(true);
  });
});
