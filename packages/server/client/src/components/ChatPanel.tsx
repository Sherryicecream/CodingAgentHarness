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
    const res = await fetch('/api/agent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, workingDir: process.cwd?.() ?? '/tmp' }),
    });
    const data = await res.json();
    setSessionId(data.sessionId);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={task}
          onChange={e => setTask(e.target.value)}
          placeholder="Enter a coding task..."
          style={{ flex: 1, padding: 8 }}
          disabled={running}
        />
        <button onClick={handleSubmit} disabled={running || !task.trim()}>
          {running ? 'Running...' : 'Send'}
        </button>
      </div>

      {error && <div style={{ color: 'red' }}>{error}</div>}

      <div>
        {events.map((e, i) => {
          if (e.type === 'tool_call') return <ToolCallCard key={i} data={e.data} />;
          if (e.type === 'guardrail') return <GuardrailDialog key={i} data={e.data} sessionId={sessionId!} />;
          if (e.type === 'complete') return <div key={i} style={{ color: 'green', fontWeight: 'bold' }}>Task completed!</div>;
          return <div key={i} style={{ padding: 8, background: '#f5f5f5', marginBottom: 4, borderRadius: 4 }}>{e.data?.content || e.type}</div>;
        })}
      </div>
    </div>
  );
}