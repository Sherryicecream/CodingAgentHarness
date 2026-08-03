import React, { useState } from 'react';
import { useSSE, generateSessionId } from '../hooks/useSSE.js';
import { ToolCallCard } from './ToolCallCard.js';
import { GuardrailDialog } from './GuardrailDialog.js';
import { FeedbackTimeline } from './FeedbackTimeline.js';

export function ChatPanel() {
  const [task, setTask] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const { events, isConnected, error } = useSSE(sessionId);

  const handleSubmit = async () => {
    if (!task.trim()) return;
    setRunning(true);

    // Generate sessionId and connect SSE FIRST
    const sid = generateSessionId();
    setSessionId(sid);

    // Small delay to ensure EventSource connection is established
    await new Promise(r => setTimeout(r, 100));

    // Then POST to run the agent
    try {
      const res = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, workingDir: '/tmp/harness-workspace', sessionId: sid }),
      });

      if (!res.ok) {
        setRunning(false);
      }
    } catch {
      setRunning(false);
    }
  };

  const lastEvent = events[events.length - 1];
  const isComplete = lastEvent?.type === 'complete';
  const feedbackRuns = events
    .filter(e => e.type === 'feedback')
    .map(e => e.data);

  return (
    <div className="chat-panel">
      <div className="chat-input-row">
        <input
          className="input"
          value={task}
          onChange={e => setTask(e.target.value)}
          placeholder="Enter a coding task... (e.g., 'write a function that calculates fibonacci')"
          disabled={running}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
        />
        <button
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={running || !task.trim()}
        >
          {running ? 'Running...' : 'Send'}
        </button>
      </div>

      {isConnected && !isComplete && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="status-dot status-dot-pass"></span>
          Connected — agent is working
        </div>
      )}

      {error && <div className="event-error">{error}</div>}

      <div className="event-stream">
        {events.map((e, i) => {
          if (e.type === 'tool_call') {
            return <ToolCallCard key={i} data={e.data} />;
          }
          if (e.type === 'guardrail') {
            return <GuardrailDialog key={i} data={e.data} sessionId={sessionId!} />;
          }
          if (e.type === 'feedback') {
            const fb = e.data;
            return (
              <div key={i} className="event-message" style={{ borderLeft: `3px solid ${fb.status === 'pass' ? 'var(--color-success)' : 'var(--color-danger)'}` }}>
                <strong>Feedback:</strong> {fb.status === 'pass' ? '✅ All tests passed' : `❌ ${fb.failures?.length || 0} test(s) failed`}
                {fb.failures?.map((f: any, j: number) => (
                  <div key={j} style={{ fontSize: 12, marginTop: 4, color: 'var(--color-text-secondary)' }}>
                    {f.file}:{f.line} — {f.message} ({f.type})
                  </div>
                ))}
              </div>
            );
          }
          if (e.type === 'loop_step') {
            return (
              <div key={i} className="event-message">
                <strong>Step {e.data.iteration || ''}:</strong> {e.data.content || e.data.phase}
              </div>
            );
          }
          if (e.type === 'error') {
            return (
              <div key={i} className="event-error">
                <strong>Error:</strong> {e.data?.message || 'Unknown error'}
                <div style={{ fontSize: 12, marginTop: 4, color: 'var(--color-text-muted)' }}>
                  The agent encountered an error. Check that your API key is valid and the DeepSeek API is accessible.
                </div>
              </div>
            );
          }
          if (e.type === 'complete') {
            return (
              <div key={i} className="event-complete">
                ✅ Task {e.data.status}
              </div>
            );
          }
          return (
            <div key={i} className="event-message">
              {e.data?.content || e.type}
            </div>
          );
        })}
      </div>

      {isComplete && feedbackRuns.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <FeedbackTimeline runs={feedbackRuns.map((fb: any, idx: number) => ({
            iteration: idx,
            testResult: fb.status === 'pass' ? 'pass' as const : 'fail' as const,
            failureCount: fb.failures?.length || 0,
            fixApplied: false,
            timeSpent: 0,
          }))} />
        </div>
      )}
    </div>
  );
}