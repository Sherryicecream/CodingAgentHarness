import { useCallback, useEffect, useRef, useState } from 'react';

export type RuntimeMode = 'public' | 'local';
export type RuntimeExperience = 'demo' | 'byok' | 'server';

export interface RuntimeCapabilities {
  allowedExperiences: RuntimeExperience[];
  allowByok: boolean;
  allowProcessTools: boolean;
  allowServerCredentials: boolean;
}

export interface RuntimeSession {
  sessionId: string;
  mode: RuntimeMode;
  capabilities: RuntimeCapabilities;
  workspaceRoot: string | null;
  expiresAt: string;
}

const issueSession = async (): Promise<RuntimeSession> => {
  const response = await fetch('/api/agent/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!response.ok) throw new Error('SESSION_ISSUE_FAILED');
  return response.json() as Promise<RuntimeSession>;
};

export function useRuntimeInfo() {
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cachedSession = useRef<RuntimeSession | null>(null);
  const bootstrapRequest = useRef<Promise<RuntimeSession> | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async (): Promise<RuntimeSession> => {
    const session = await issueSession();
    if (mounted.current) {
      setRuntimeInfo(session);
      setError(null);
    }
    return session;
  }, []);

  useEffect(() => {
    mounted.current = true;
    bootstrapRequest.current ??= load();
    bootstrapRequest.current
      .then((session) => {
        cachedSession.current = session;
      })
      .catch(() => {
        if (mounted.current) setError('无法加载运行模式，请稍后重试。');
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
      cachedSession.current = null;
    };
  }, [load]);

  const acquireSession = useCallback(async (): Promise<RuntimeSession> => {
    const cached = cachedSession.current;
    if (cached) {
      cachedSession.current = null;
      return cached;
    }
    return load();
  }, [load]);

  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    load()
      .then((session) => {
        cachedSession.current = session;
      })
      .catch(() => {
        if (mounted.current) setError('无法加载运行模式，请稍后重试。');
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
  }, [load]);

  return { runtimeInfo, loading, error, acquireSession, retry };
}
