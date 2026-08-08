const REDACTED = '[REDACTED]';
const CIRCULAR = '[Circular]';
const UNSERIALIZABLE = '[UNSERIALIZABLE]';

const normalizeSecrets = (secrets: readonly string[]): string[] => (
  [...new Set(secrets.filter((secret) => secret.length > 0))]
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
    if (ancestors.has(current)) {
      return CIRCULAR;
    }

    ancestors.add(current);
    try {
      if (current instanceof Date) {
        const timestamp = current.getTime();
        return Number.isNaN(timestamp) ? UNSERIALIZABLE : current.toISOString();
      }

      const output: Record<string, unknown> | unknown[] = Array.isArray(current) ? [] : {};
      let keys: (string | symbol)[];
      try {
        keys = Reflect.ownKeys(current);
      } catch {
        return UNSERIALIZABLE;
      }

      if (current instanceof Error) {
        const errorOutput = output as Record<string, unknown>;
        errorOutput.name = redactString(current.name, normalizedSecrets);
        errorOutput.message = redactString(current.message, normalizedSecrets);
      }

      for (const key of keys) {
        if (typeof key !== 'string' || key === 'stack') {
          continue;
        }
        let descriptor: PropertyDescriptor | undefined;
        try {
          descriptor = Object.getOwnPropertyDescriptor(current, key);
        } catch {
          (output as Record<string, unknown>)[redactString(key, normalizedSecrets)] = UNSERIALIZABLE;
          continue;
        }
        if (!descriptor?.enumerable) {
          continue;
        }
        let child: unknown;
        try {
          child = Reflect.get(current, key);
        } catch {
          child = UNSERIALIZABLE;
        }
        (output as Record<string, unknown>)[redactString(key, normalizedSecrets)] = visit(child);
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
