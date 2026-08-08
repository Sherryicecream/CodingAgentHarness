import { useCallback, useEffect, useRef, useState } from 'react';

export interface SSEEvent {
  type: string;
  data: any;
  timestamp: string;
}

export function useSSE() {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pendingRejectRef = useRef<((error: Error) => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearPending = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRejectRef.current = null;
  }, []);

  const close = useCallback(() => {
    const source = eventSourceRef.current;
    eventSourceRef.current = null;
    source?.close();
    pendingRejectRef.current?.(new Error('SSE_CONNECTION_CLOSED'));
    clearPending();
    if (mountedRef.current) setIsConnected(false);
  }, [clearPending]);

  const connect = useCallback((sessionId: string, timeoutMs = 5_000): Promise<void> => {
    close();
    setEvents([]);
    setError(null);
    setIsConnected(false);

    const source = new EventSource(`/api/agent/stream/${encodeURIComponent(sessionId)}`);
    eventSourceRef.current = source;

    return new Promise<void>((resolve, reject) => {
      let opened = false;
      let settled = false;
      const settle = (failure?: Error) => {
        if (settled) return;
        settled = true;
        clearPending();
        if (failure) reject(failure);
        else resolve();
      };
      pendingRejectRef.current = (failure) => settle(failure);
      timerRef.current = setTimeout(() => {
        if (eventSourceRef.current === source) {
          eventSourceRef.current = null;
          source.close();
        }
        if (mountedRef.current) {
          setError('实时连接超时，请重试。');
          setIsConnected(false);
        }
        settle(new Error('SSE_CONNECTION_TIMEOUT'));
      }, timeoutMs);

      source.onopen = () => {
        if (eventSourceRef.current !== source) return;
        opened = true;
        if (mountedRef.current) setIsConnected(true);
        settle();
      };

      source.onmessage = (message) => {
        if (eventSourceRef.current !== source) return;
        let parsed: SSEEvent;
        try {
          parsed = JSON.parse(message.data) as SSEEvent;
        } catch {
          if (mountedRef.current) setError('收到无法解析的实时事件。');
          return;
        }
        if (mountedRef.current) {
          setEvents((previous) => [...previous, parsed]);
          if (parsed.type === 'error') setError('运行失败，请检查输入后重试。');
        }
        if (parsed.type === 'complete' || parsed.type === 'error') {
          eventSourceRef.current = null;
          source.close();
          if (mountedRef.current) setIsConnected(false);
        }
      };

      source.onerror = () => {
        if (eventSourceRef.current !== source) return;
        eventSourceRef.current = null;
        source.close();
        if (mountedRef.current) {
          setError(opened ? '实时连接已中断，请重试。' : '无法建立实时连接，请重试。');
          setIsConnected(false);
        }
        if (!opened) settle(new Error('SSE_CONNECTION_FAILED'));
      };
    });
  }, [clearPending, close]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const source = eventSourceRef.current;
      eventSourceRef.current = null;
      source?.close();
      pendingRejectRef.current?.(new Error('SSE_COMPONENT_UNMOUNTED'));
      clearPending();
    };
  }, [clearPending]);

  return { events, isConnected, error, connect, close };
}
