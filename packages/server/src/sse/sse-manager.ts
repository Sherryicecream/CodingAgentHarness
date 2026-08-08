import { Response } from 'express';
import { redactSecrets } from '../security/secret-redactor.js';

export interface SSEEvent {
  type: 'loop_step' | 'tool_call' | 'guardrail' | 'feedback' | 'complete' | 'error';
  data: unknown;
  timestamp: Date;
}

export interface SSEManager {
  createConnection(sessionId: string, res: Response): void;
  disconnect?(sessionId: string): void;
  setSecrets?(sessionId: string, secrets: readonly string[]): void;
  clearSecrets?(sessionId: string): void;
  push(sessionId: string, event: SSEEvent): void;
  close(sessionId: string): void;
}

export interface SecretAwareSSEManager extends SSEManager {
  disconnect(sessionId: string): void;
  setSecrets(sessionId: string, secrets: readonly string[]): void;
  clearSecrets(sessionId: string): void;
}

export function createSSEManager(): SecretAwareSSEManager {
  const connections = new Map<string, Response>();
  const buffers = new Map<string, string[]>();
  const secretsBySession = new Map<string, readonly string[]>();

  const serialize = (sessionId: string, event: SSEEvent): string => {
    const safeEvent = redactSecrets({
      ...event,
      timestamp: event.timestamp.toISOString(),
    }, secretsBySession.get(sessionId) ?? []);
    try {
      return `data: ${JSON.stringify(safeEvent)}\n\n`;
    } catch {
      return `data: ${JSON.stringify({
        type: 'error',
        data: { error: 'EVENT_SERIALIZATION_FAILED' },
        timestamp: event.timestamp.toISOString(),
      })}\n\n`;
    }
  };
  const disconnect = (sessionId: string): void => {
    const res = connections.get(sessionId);
    if (res) {
      res.end();
      connections.delete(sessionId);
    }
  };

  return {
    createConnection(sessionId: string, res: Response) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      connections.set(sessionId, res);

      // Flush buffered events
      const buffer = buffers.get(sessionId) || [];
      for (const serializedEvent of buffer) {
        res.write(serializedEvent);
      }
      buffers.delete(sessionId);
    },

    setSecrets(sessionId: string, secrets: readonly string[]) {
      secretsBySession.set(sessionId, [...secrets]);
    },

    clearSecrets(sessionId: string) {
      secretsBySession.delete(sessionId);
    },

    disconnect,

    push(sessionId: string, event: SSEEvent) {
      const serializedEvent = serialize(sessionId, event);
      const res = connections.get(sessionId);
      if (res) {
        res.write(serializedEvent);
      } else {
        // Buffer event until connection is established
        const buffer = buffers.get(sessionId) || [];
        buffer.push(serializedEvent);
        buffers.set(sessionId, buffer);
      }
    },

    close(sessionId: string) {
      disconnect(sessionId);
      buffers.delete(sessionId);
      secretsBySession.delete(sessionId);
    },
  };
}
