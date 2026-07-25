import React, { useState } from 'react';

export function GuardrailDialog({ data, sessionId }: { data: any; sessionId: string }) {
  const [handled, setHandled] = useState(false);

  const handleApprove = async () => {
    await fetch('/api/agent/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    setHandled(true);
  };

  const handleReject = async () => {
    await fetch('/api/agent/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    setHandled(true);
  };

  if (handled) return <div style={{ color: '#666' }}>Action handled.</div>;

  return (
    <div style={{ border: '2px solid #f44336', borderRadius: 4, padding: 12, marginBottom: 8, background: '#fff3f3' }}>
      <h3 style={{ margin: 0, color: '#f44336' }}>⚠️ Dangerous Action Detected</h3>
      <p><strong>Command:</strong> {data.command}</p>
      <p style={{ color: '#666' }}>This action requires your approval to proceed.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handleApprove} style={{ background: '#f44336', color: 'white', border: 'none', padding: '8px 16px', borderRadius: 4 }}>Approve</button>
        <button onClick={handleReject} style={{ background: '#ccc', border: 'none', padding: '8px 16px', borderRadius: 4 }}>Reject</button>
      </div>
    </div>
  );
}