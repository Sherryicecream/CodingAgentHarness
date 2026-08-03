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
    return <div className="guardrail-handled">操作已处理。</div>;
  }

  const toolName = data.toolCall?.name || '';
  const toolArgs = data.toolCall?.arguments || {};

  return (
    <div className="guardrail-dialog">
      <h3 className="guardrail-title">⚠️ 检测到危险操作</h3>
      <div className="guardrail-command">
        <strong>工具：</strong>{toolName}<br />
        <strong>参数：</strong>{JSON.stringify(toolArgs)}
      </div>
      <p className="guardrail-description">
        此操作需要你的批准才能继续。请确认是否允许执行。
      </p>
      <div className="guardrail-actions">
        <button className="btn btn-danger" onClick={() => handleAction('approve')}>
          批准
        </button>
        <button className="btn btn-secondary" onClick={() => handleAction('reject')}>
          拒绝
        </button>
      </div>
    </div>
  );
}