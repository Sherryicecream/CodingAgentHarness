import React from 'react';

export function ToolCallCard({ data }: { data: any }) {
  return (
    <div className="tool-call-card">
      <div className="tool-call-header">
        <span className={`badge badge-${data.riskLevel || 'safe'}`}>
          {data.riskLevel || 'safe'}
        </span>
        <span className="tool-call-name">{data.name}</span>
      </div>
      <div className="tool-call-status">
        {data.result?.success ? '✅ Success' : '❌ Failed'}
      </div>
      <details className="tool-call-details">
        <summary>Details</summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}