import React from 'react';

const riskColors: Record<string, string> = { safe: '#4caf50', moderate: '#ff9800', dangerous: '#f44336' };

export function ToolCallCard({ data }: { data: any }) {
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 4, padding: 8, marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ background: riskColors[data.riskLevel] || '#999', color: 'white', padding: '2px 6px', borderRadius: 3, fontSize: 12 }}>
          {data.riskLevel || 'safe'}
        </span>
        <strong>{data.name}</strong>
      </div>
      <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
        {data.result?.success ? '✅ Success' : '❌ Failed'}
      </div>
      <details>
        <summary>Details</summary>
        <pre style={{ fontSize: 11, background: '#f0f0f0', padding: 8 }}>{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}