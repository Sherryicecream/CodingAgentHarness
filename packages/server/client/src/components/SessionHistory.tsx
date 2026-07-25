import React, { useEffect, useState } from 'react';
import { FeedbackTimeline } from './FeedbackTimeline.js';

interface Session {
  id: string;
  createdAt: string;
  task: string;
  status: 'running' | 'blocked' | 'completed' | 'failed';
  conclusion: string | null;
  feedbackRuns: Array<{
    iteration: number;
    testResult: 'pass' | 'fail';
    failureCount: number;
    fixApplied: boolean;
    timeSpent: number;
  }>;
}

const statusColors: Record<string, string> = {
  running: '#2196f3',
  blocked: '#ff9800',
  completed: '#4caf50',
  failed: '#f44336',
};

export function SessionHistory() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/sessions')
      .then(res => res.json())
      .then(data => {
        setSessions(data.sessions || []);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <div style={{ padding: 20, color: '#666' }}>Loading sessions...</div>;
  if (error) return <div style={{ padding: 20, color: '#f44336' }}>Error: {error}</div>;
  if (sessions.length === 0) return <div style={{ padding: 20, color: '#999' }}>No sessions yet. Run a task from the Chat tab first.</div>;

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>Session History</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sessions.map(session => {
          const isExpanded = expandedId === session.id;
          const createdAt = new Date(session.createdAt);
          const timeStr = createdAt.toLocaleString();

          return (
            <div
              key={session.id}
              style={{
                border: '1px solid #ddd',
                borderRadius: 6,
                padding: 12,
                background: '#fff',
                cursor: 'pointer',
              }}
              onClick={() => setExpandedId(isExpanded ? null : session.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{session.task}</div>
                  <div style={{ fontSize: 12, color: '#888' }}>{timeStr}</div>
                </div>
                <span style={{
                  background: statusColors[session.status] || '#999',
                  color: 'white',
                  padding: '2px 8px',
                  borderRadius: 3,
                  fontSize: 12,
                  fontWeight: 600,
                  marginLeft: 12,
                  whiteSpace: 'nowrap',
                }}>
                  {session.status}
                </span>
              </div>

              {session.conclusion && (
                <div style={{ fontSize: 13, color: '#555', marginBottom: 4 }}>
                  {session.conclusion}
                </div>
              )}

              <div style={{ fontSize: 12, color: '#999' }}>
                {session.feedbackRuns?.length || 0} feedback iteration(s) —{' '}
                {isExpanded ? 'Click to collapse' : 'Click to expand'}
              </div>

              {isExpanded && (
                <div style={{ marginTop: 8, borderTop: '1px solid #eee', paddingTop: 8 }}>
                  <FeedbackTimeline runs={session.feedbackRuns || []} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}