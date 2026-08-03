import React, { useState } from 'react';

export function GuardrailDialog({ data, sessionId }: { data: any; sessionId: string }) {
  const [handled, setHandled] = useState(false);

  const handleAction = async (action: 'approve' | 'reject') => {
    await fetch(`/api/agent/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    setHandled(true);
  };

  if (handled) {
    return <div className="guardrail-handled">Action handled.</div>;
  }

  return (
    <div className="guardrail-dialog">
      <h3 className="guardrail-title">⚠️ Dangerous Action Detected</h3>
      <div className="guardrail-command">{data.command}</div>
      <p className="guardrail-description">
        This action requires your approval to proceed. Review the command above and decide.
      </p>
      <div className="guardrail-actions">
        <button className="btn btn-danger" onClick={() => handleAction('approve')}>
          Approve
        </button>
        <button className="btn btn-secondary" onClick={() => handleAction('reject')}>
          Reject
        </button>
      </div>
    </div>
  );
}