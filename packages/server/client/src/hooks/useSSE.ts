import { useState, useEffect, useRef } from 'react';

export interface SSEEvent {
  type: string;
  data: any;
  timestamp: string;
}

export function useSSE(sessionId: string | null) {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const es = new EventSource(`/api/agent/stream/${sessionId}`);
    eventSourceRef.current = es;
    setIsConnected(true);

    es.onmessage = (event) => {
      const parsed = JSON.parse(event.data);
      setEvents(prev => [...prev, parsed]);
      if (parsed.type === 'complete') {
        es.close();
        setIsConnected(false);
      }
    };

    es.onerror = () => {
      setError('Connection lost');
      setIsConnected(false);
    };

    return () => { es.close(); };
  }, [sessionId]);

  return { events, isConnected, error };
}