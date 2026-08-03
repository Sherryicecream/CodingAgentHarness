import React, { useState } from 'react';
import { useSSE } from '../hooks/useSSE.js';
import { ToolCallCard } from './ToolCallCard.js';
import { GuardrailDialog } from './GuardrailDialog.js';

export function ChatPanel() {
  const [task, setTask] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const { events, isConnected, error } = useSSE(sessionId);

  const handleSubmit = async () => {
    if (!task.trim()) return;
    setRunning(true);
    try {
      const res = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, workingDir: '/tmp' }),
      });
      const data = await res.json();
      setSessionId(data.sessionId);
    } catch {
      setRunning(false);
    }
  };

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

      {isConnected && (
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
          if (e.type === 'complete') {
            return (
              <div key={i} className="event-complete">
                ✅ Task completed
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
    </div>
  );
}