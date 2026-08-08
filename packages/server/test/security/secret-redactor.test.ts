import { describe, expect, it } from 'vitest';
import type { Session } from '@harness/core';
import {
  redactSecrets,
  sanitizeSessionSecrets,
} from '../../src/security/secret-redactor.js';

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
    let getterCalls = 0;
    const input = Object.defineProperty({}, 'payload', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error(`getter exposed ${SENTINEL}`);
      },
    });

    const result = redactSecrets(input, [SENTINEL]);
    const serialized = JSON.stringify(result);

    expect(serialized).toBe('{"payload":"[UNSERIALIZABLE]"}');
    expect(serialized).not.toContain(SENTINEL);
    expect(getterCalls).toBe(0);
  });

  it('redacts overlapping secrets longest-first without leaving suffixes', () => {
    const single = redactSecrets('abcdef', ['abc', '', 'abcdef', 'abc']);
    const repeated = redactSecrets('abcdef abc abcdef', ['abc', '', 'abcdef', 'abc']);

    expect(single).toBe('[REDACTED]');
    expect(repeated).toBe('[REDACTED] [REDACTED] [REDACTED]');
    expect(String(repeated)).not.toContain('def');
  });

  it('replaces binary and boxed string values without exposing reversible contents', () => {
    const bytes = Buffer.from(SENTINEL, 'utf8');
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    const input = [
      bytes,
      new Uint8Array(arrayBuffer),
      new DataView(arrayBuffer),
      arrayBuffer,
      new String(SENTINEL),
    ];

    const result = redactSecrets(input, [SENTINEL]);
    const serialized = JSON.stringify(result);

    expect(result).toEqual(Array.from({ length: 5 }, () => '[REDACTED]'));
    expect(serialized).not.toContain(SENTINEL);
    expect(Object.values(result as object).join('')).not.toContain(SENTINEL);
    expect(String(result)).not.toContain(SENTINEL);
  });

  it('does not invoke toJSON/accessors or expose Map, Set, Symbol, and cycle contents', () => {
    let toJsonCalls = 0;
    let getterCalls = 0;
    const input: Record<string, unknown> = {
      map: new Map([[SENTINEL, SENTINEL]]),
      set: new Set([SENTINEL]),
      symbol: Symbol(SENTINEL),
      toJSON: () => { toJsonCalls += 1; return SENTINEL; },
    };
    Object.defineProperty(input, 'getter', {
      enumerable: true,
      get: () => { getterCalls += 1; return SENTINEL; },
    });
    input.self = input;

    const result = redactSecrets(input, [SENTINEL]);
    const serialized = JSON.stringify(result);

    expect(toJsonCalls).toBe(0);
    expect(getterCalls).toBe(0);
    expect(serialized).not.toContain(SENTINEL);
    expect(serialized).toContain('[Circular]');
  });

  it('sanitizes a Session without changing its Date-valued fields or structure', () => {
    const createdAt = new Date('2026-08-08T00:00:00.000Z');
    const updatedAt = new Date('2026-08-08T00:01:00.000Z');
    const session = {
      id: 'typed-session',
      createdAt,
      updatedAt,
      task: `task ${SENTINEL}`,
      messages: [{ role: 'assistant' as const, content: `echo ${SENTINEL}` }],
      toolCalls: [{
        timestamp: new Date('2026-08-08T00:00:30.000Z'),
        toolName: 'read_file',
        params: { value: SENTINEL },
        result: { success: false, output: '', error: SENTINEL },
        guardrailCheck: 'passed' as const,
      }],
      feedbackRuns: [],
      status: 'completed' as const,
      conclusion: `done ${SENTINEL}`,
    } satisfies Session & { updatedAt: Date };

    const result = sanitizeSessionSecrets(session, [SENTINEL]);

    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.updatedAt).toBeInstanceOf(Date);
    expect(result.toolCalls[0]?.timestamp).toBeInstanceOf(Date);
    expect(result.createdAt.toISOString()).toBe('2026-08-08T00:00:00.000Z');
    expect(result.updatedAt?.toISOString()).toBe('2026-08-08T00:01:00.000Z');
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    expect(session.task).toContain(SENTINEL);
    expect(session.createdAt).toBe(createdAt);
  });

  it('rejects live and revoked Proxy values without invoking any traps', () => {
    const trapCalls = {
      getPrototypeOf: 0,
      ownKeys: 0,
      getOwnPropertyDescriptor: 0,
    };
    const liveProxy = new Proxy({ value: SENTINEL }, {
      getPrototypeOf(target) {
        trapCalls.getPrototypeOf += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        trapCalls.ownKeys += 1;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, property) {
        trapCalls.getOwnPropertyDescriptor += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const revoked = Proxy.revocable({ value: SENTINEL }, {});
    revoked.revoke();

    const result = redactSecrets([liveProxy, revoked.proxy], [SENTINEL]);

    expect(result).toEqual(['[REDACTED]', '[REDACTED]']);
    expect(trapCalls).toEqual({
      getPrototypeOf: 0,
      ownKeys: 0,
      getOwnPropertyDescriptor: 0,
    });
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });
});
