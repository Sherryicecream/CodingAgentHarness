import { useState, useEffect, useRef } from 'react';

export interface SSEEvent {
  type: string;
  data: any;
  timestamp: string;
}

export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export function useSSE(sessionId: string | null) {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const connectionResolveRef = useRef<(() => void) | null>(null);
  const connectionPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    setEvents([]);
    setError(null);
    setIsConnected(false);

    // Create a promise that resolves when SSE connects
    connectionPromiseRef.current = new Promise<void>((resolve) => {
      connectionResolveRef.current = resolve;
    });

    const es = new EventSource(`/api/agent/stream/${sessionId}`);
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
      connectionResolveRef.current?.();
      connectionResolveRef.current = null;
    };

    es.onmessage = (event) => {
      const parsed = JSON.parse(event.data);
      setEvents(prev => [...prev, parsed]);
      if (parsed.type === 'error') {
        setError(parsed.data?.message || '发生了一个错误');
      }
      if (parsed.type === 'complete') {
        es.close();
        setIsConnected(false);
      }
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setIsConnected(false);
      }
    };

    return () => {
      es.close();
      setIsConnected(false);
      connectionPromiseRef.current = null;
      connectionResolveRef.current = null;
    };
  }, [sessionId]);

  /** Wait for the SSE connection to be established (use after setting sessionId) */
  const waitForConnection = async (timeoutMs = 3000): Promise<boolean> => {
    const promise = connectionPromiseRef.current;
    if (!promise) return false;
    const result = await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
    return result;
  };

  return { events, isConnected, error, waitForConnection };
}