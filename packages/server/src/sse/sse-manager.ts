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

  return {
    createConnection(sessionId: string, res: Response) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      connections.set(sessionId, res);
    },

    push(sessionId: string, event: SSEEvent) {
      const res = connections.get(sessionId);
      if (res) {
        res.write(`data: ${JSON.stringify({ ...event, timestamp: event.timestamp.toISOString() })}\n\n`);
      }
    },

    close(sessionId: string) {
      const res = connections.get(sessionId);
      if (res) {
        res.end();
        connections.delete(sessionId);
      }
    },
  };
}