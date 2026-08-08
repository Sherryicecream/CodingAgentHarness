import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../../src/security/secret-redactor.js';

const SENTINEL = 'sk-test-redaction-sentinel';

describe('redactSecrets', () => {
  it('redacts every exact secret occurrence in nested data without mutating the input', () => {
    const input = {
      message: `before ${SENTINEL} after ${SENTINEL}`,
      nested: [{ authorization: `Bearer ${SENTINEL}` }],
      [SENTINEL]: 'secret-named property',
    };

    const result = redactSecrets(input, [SENTINEL]);

    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    expect(result).toEqual({
      message: 'before [REDACTED] after [REDACTED]',
      nested: [{ authorization: 'Bearer [REDACTED]' }],
      '[REDACTED]': 'secret-named property',
    });
    expect(input.message).toContain(SENTINEL);
    expect(input.nested[0]?.authorization).toContain(SENTINEL);
    expect(Object.keys(input)).toContain(SENTINEL);
  });

  it('returns serializable safe values for cyclic objects and errors', () => {
    const error = new Error(`provider echoed ${SENTINEL}`) as Error & {
      responseBody?: string;
      statusCode?: number;
    };
    error.responseBody = `{"key":"${SENTINEL}"}`;
    error.statusCode = 401;
    const cyclic: Record<string, unknown> = { error };
    cyclic.self = cyclic;

    const result = redactSecrets(cyclic, [SENTINEL]);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(SENTINEL);
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).toContain('[Circular]');
    expect(error.message).toContain(SENTINEL);
    expect(error.responseBody).toContain(SENTINEL);
  });

  it('does not leak when an input property cannot be read', () => {
    const input = Object.defineProperty({}, 'payload', {
      enumerable: true,
      get: () => { throw new Error(`getter exposed ${SENTINEL}`); },
    });

    const result = redactSecrets(input, [SENTINEL]);
    const serialized = JSON.stringify(result);

    expect(serialized).toBe('{"payload":"[UNSERIALIZABLE]"}');
    expect(serialized).not.toContain(SENTINEL);
  });
});
