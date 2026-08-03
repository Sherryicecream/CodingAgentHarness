import React from 'react';

export function ToolCallCard({ data }: { data: any }) {
  return (
    <div className="tool-call-card">
      <div className="tool-call-header">
        <span className={`badge badge-${data.riskLevel || 'safe'}`}>
          {data.riskLevel === 'dangerous' ? '危险' : data.riskLevel === 'moderate' ? '中等' : '安全'}
        </span>
        <span className="tool-call-name">{data.name}</span>
      </div>
      <div className="tool-call-status">
        {data.result?.success ? '✅ 成功' : '❌ 失败'}
      </div>
      <details className="tool-call-details">
        <summary>详情</summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}