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

  useEffect(() => {
    if (!sessionId) return;

    setEvents([]);
    setError(null);

    // Connect to SSE FIRST, before any events are emitted
    const es = new EventSource(`/api/agent/stream/${sessionId}`);
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
    };

    es.onmessage = (event) => {
      const parsed = JSON.parse(event.data);
      setEvents(prev => [...prev, parsed]);
      // If it's an error event, also set the error state
      if (parsed.type === 'error') {
        setError(parsed.data?.message || 'An error occurred');
      }
      if (parsed.type === 'complete') {
        es.close();
        setIsConnected(false);
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects, only show error after multiple failures
      if (es.readyState === EventSource.CLOSED) {
        setIsConnected(false);
      }
    };

    return () => {
      es.close();
      setIsConnected(false);
    };
  }, [sessionId]);

  return { events, isConnected, error };
}