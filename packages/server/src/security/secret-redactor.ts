import type { Session } from '@harness/core';
import { types as utilTypes } from 'node:util';

const REDACTED = '[REDACTED]';
const CIRCULAR = '[Circular]';
const UNSERIALIZABLE = '[UNSERIALIZABLE]';

const normalizeSecrets = (secrets: readonly string[]): string[] => (
  [...new Set(secrets.filter((secret) => secret.length > 0))]
    .sort((left, right) => right.length - left.length)
);

const redactString = (value: string, secrets: readonly string[]): string => {
  let redacted = value;
  for (const secret of secrets) {
    redacted = redacted.split(secret).join(REDACTED);
  }
  return redacted;
};

export const redactSecrets = (
  value: unknown,
  secrets: readonly string[],
): unknown => {
  const normalizedSecrets = normalizeSecrets(secrets);
  const ancestors = new WeakSet<object>();

  const visit = (current: unknown): unknown => {
    if (typeof current === 'string') {
      return redactString(current, normalizedSecrets);
    }
    if (
      current === null
      || typeof current === 'number'
      || typeof current === 'boolean'
    ) {
      return current;
    }
    if (typeof current === 'bigint') {
      return current.toString();
    }
    if (
      current === undefined
      || typeof current === 'function'
      || typeof current === 'symbol'
    ) {
      return UNSERIALIZABLE;
    }
    if (typeof current !== 'object') {
      return UNSERIALIZABLE;
    }
    try {
      if (utilTypes.isProxy(current)) {
        return REDACTED;
      }
    } catch {
      return REDACTED;
    }
    if (ancestors.has(current)) {
      return CIRCULAR;
    }

    ancestors.add(current);
    try {
      if (
        current instanceof String
        || current instanceof ArrayBuffer
        || ArrayBuffer.isView(current)
        || (typeof SharedArrayBuffer !== 'undefined' && current instanceof SharedArrayBuffer)
      ) {
        return REDACTED;
      }
      if (current instanceof Map || current instanceof Set) {
        return UNSERIALIZABLE;
      }
      if (current instanceof Date) {
        const timestamp = Date.prototype.getTime.call(current);
        return Number.isNaN(timestamp)
          ? UNSERIALIZABLE
          : Date.prototype.toISOString.call(current);
      }

      const output: Record<string, unknown> | unknown[] = Array.isArray(current)
        ? []
        : Object.create(null) as Record<string, unknown>;
      let keys: (string | symbol)[];
      try {
        keys = Reflect.ownKeys(current);
      } catch {
        return UNSERIALIZABLE;
      }

      if (current instanceof Error) {
        const errorOutput = output as Record<string, unknown>;
        const nameDescriptor = Object.getOwnPropertyDescriptor(current, 'name');
        const messageDescriptor = Object.getOwnPropertyDescriptor(current, 'message');
        errorOutput.name = typeof nameDescriptor?.value === 'string'
          ? redactString(nameDescriptor.value, normalizedSecrets)
          : 'Error';
        errorOutput.message = typeof messageDescriptor?.value === 'string'
          ? redactString(messageDescriptor.value, normalizedSecrets)
          : UNSERIALIZABLE;
      }

      for (const key of keys) {
        if (typeof key !== 'string' || key === 'stack') {
          continue;
        }
        let descriptor: PropertyDescriptor | undefined;
        try {
          descriptor = Object.getOwnPropertyDescriptor(current, key);
        } catch {
          Object.defineProperty(output, redactString(key, normalizedSecrets), {
            value: UNSERIALIZABLE,
            enumerable: true,
            configurable: true,
            writable: true,
          });
          continue;
        }
        if (!descriptor?.enumerable) {
          continue;
        }
        const child = 'value' in descriptor ? descriptor.value : UNSERIALIZABLE;
        Object.defineProperty(output, redactString(key, normalizedSecrets), {
          value: visit(child),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return output;
    } catch {
      return UNSERIALIZABLE;
    } finally {
      ancestors.delete(current);
    }
  };

  return visit(value);
};

export interface SessionWithOptionalUpdatedAt extends Session {
  readonly updatedAt?: Date;
}

const redactRecord = (
  value: Record<string, unknown>,
  secrets: readonly string[],
): Record<string, unknown> => {
  const redacted = redactSecrets(value, secrets);
  return typeof redacted === 'object' && redacted !== null && !Array.isArray(redacted)
    ? redacted as Record<string, unknown>
    : {};
};

export const sanitizeSessionSecrets = (
  session: SessionWithOptionalUpdatedAt,
  secrets: readonly string[],
): SessionWithOptionalUpdatedAt => {
  const normalizedSecrets = normalizeSecrets(secrets);
  return {
    id: redactString(session.id, normalizedSecrets),
    createdAt: new Date(session.createdAt.getTime()),
    ...(session.updatedAt
      ? { updatedAt: new Date(session.updatedAt.getTime()) }
      : {}),
    task: redactString(session.task, normalizedSecrets),
    messages: session.messages.map((message) => ({
      role: message.role,
      content: redactString(message.content, normalizedSecrets),
      ...(message.toolCallId === undefined
        ? {}
        : { toolCallId: redactString(message.toolCallId, normalizedSecrets) }),
      ...(message.name === undefined
        ? {}
        : { name: redactString(message.name, normalizedSecrets) }),
      ...(message.toolCalls === undefined
        ? {}
        : {
            toolCalls: message.toolCalls.map((toolCall) => ({
              id: redactString(toolCall.id, normalizedSecrets),
              name: redactString(toolCall.name, normalizedSecrets),
              arguments: redactRecord(toolCall.arguments, normalizedSecrets),
            })),
          }),
    })),
    toolCalls: session.toolCalls.map((toolCall) => ({
      timestamp: new Date(toolCall.timestamp.getTime()),
      toolName: redactString(toolCall.toolName, normalizedSecrets),
      params: redactRecord(toolCall.params, normalizedSecrets),
      result: {
        success: toolCall.result.success,
        output: redactString(toolCall.result.output, normalizedSecrets),
        ...(toolCall.result.error === undefined
          ? {}
          : { error: redactString(toolCall.result.error, normalizedSecrets) }),
      },
      guardrailCheck: toolCall.guardrailCheck,
    })),
    feedbackRuns: session.feedbackRuns.map((feedbackRun) => ({ ...feedbackRun })),
    status: session.status,
    conclusion: session.conclusion === null
      ? null
      : redactString(session.conclusion, normalizedSecrets),
  };
};
