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

  if (loading) return <div className="loading-text">Loading sessions...</div>;
  if (error) return <div className="event-error">Error: {error}</div>;
  if (sessions.length === 0) {
    return <div className="empty-text">No sessions yet. Run a task from the Chat tab first.</div>;
  }

  return (
    <div>
      <h2 className="section-title">Session History</h2>
      <div className="session-history">
        {sessions.map(session => {
          const isExpanded = expandedId === session.id;
          const createdAt = new Date(session.createdAt);
          const timeStr = createdAt.toLocaleString();

          return (
            <div
              key={session.id}
              className="session-card"
              onClick={() => setExpandedId(isExpanded ? null : session.id)}
            >
              <div className="session-header">
                <div>
                  <div className="session-task">{session.task}</div>
                  <div className="session-time">{timeStr}</div>
                </div>
                <span className={`badge badge-${session.status}`}>
                  {session.status}
                </span>
              </div>

              {session.conclusion && (
                <div className="session-conclusion">{session.conclusion}</div>
              )}

              <div className="session-meta">
                {session.feedbackRuns?.length || 0} feedback iteration(s)
                {' — '}
                {isExpanded ? 'Click to collapse' : 'Click to expand'}
              </div>

              {isExpanded && (
                <div className="session-expanded">
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