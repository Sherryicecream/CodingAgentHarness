import { Response } from 'express';

export interface SSEEvent {
  type: 'loop_step' | 'tool_call' | 'guardrail' | 'feedback' | 'complete' | 'error';
  data: unknown;
  timestamp: Date;
}

export interface SSEManager {
  createConnection(sessionId: string, res: Response): void;
  push(sessionId: string, event: SSEEvent): void;
  close(sessionId: string): void;
}

export function createSSEManager(): SSEManager {
  const connections = new Map<string, Response>();
  const buffers = new Map<string, SSEEvent[]>();

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
      for (const event of buffer) {
        res.write(`data: ${JSON.stringify({ ...event, timestamp: event.timestamp.toISOString() })}\n\n`);
      }
      buffers.delete(sessionId);
    },

    push(sessionId: string, event: SSEEvent) {
      const res = connections.get(sessionId);
      if (res) {
        res.write(`data: ${JSON.stringify({ ...event, timestamp: event.timestamp.toISOString() })}\n\n`);
      } else {
        // Buffer event until connection is established
        const buffer = buffers.get(sessionId) || [];
        buffer.push(event);
        buffers.set(sessionId, buffer);
      }
    },

    close(sessionId: string) {
      const res = connections.get(sessionId);
      if (res) {
        res.end();
        connections.delete(sessionId);
      }
      buffers.delete(sessionId);
    },
  };
}