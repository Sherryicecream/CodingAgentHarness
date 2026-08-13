import React, { useEffect, useState } from 'react';
import { FeedbackTimeline } from './FeedbackTimeline.js';
import { loadPublicSessions } from '../history/public-history.js';

export type SessionHistoryMode = 'public' | 'local';

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

export function SessionHistory({ mode }: { mode: SessionHistoryMode }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'public') {
      setSessions(loadPublicSessions());
      setLoading(false);
      return;
    }

    fetch('/api/sessions')
      .then(res => {
        if (res.status === 404) {
          throw new Error('NOT_AVAILABLE');
        }
        return res.json();
      })
      .then(data => {
        setSessions(data.sessions || []);
        setLoading(false);
      })
      .catch(err => {
        if (err.message === 'NOT_AVAILABLE') {
          setError('历史会话仅在本地模式下可用。');
        } else {
          setError(err.message);
        }
        setLoading(false);
      });
  }, [mode]);

  if (loading) return <div className="loading-text">加载会话列表...</div>;
  if (error) return <div className="event-error">错误：{error}</div>;
  if (sessions.length === 0) {
    return <div className="empty-text">暂无会话记录。请先在 Chat 页面运行一个任务。</div>;
  }

  return (
    <div>
      <h2 className="section-title">历史会话</h2>
      <div className="session-history">
        {sessions.map(session => {
          const isExpanded = expandedId === session.id;
          const createdAt = new Date(session.createdAt);
          const timeStr = createdAt.toLocaleString('zh-CN');

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
                <span className={`badge badge-${['completed', 'failed', 'blocked', 'running'].includes(session.status) ? session.status : 'completed'}`}>
                  {session.status === 'completed' ? '已完成' : session.status === 'failed' ? '失败' : session.status === 'blocked' ? '已拦截' : '运行中'}
                </span>
              </div>

              {session.conclusion && (
                <div className="session-conclusion">{session.conclusion}</div>
              )}

              <div className="session-meta">
                {session.feedbackRuns?.length || 0} 次反馈迭代
                {' — '}
                {isExpanded ? '点击收起' : '点击展开'}
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
