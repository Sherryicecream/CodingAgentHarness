import React, { useEffect, useState } from 'react';

interface ArtifactRecord { relativePath: string; size: number; sha256: string }

export function ArtifactExport({ sessionId }: { readonly sessionId: string }) {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}/artifacts`)
      .then(response => response.ok ? response.json() : Promise.reject(new Error('ARTIFACT_LIST_FAILED')))
      .then(body => setArtifacts(Array.isArray(body.artifacts) ? body.artifacts : []))
      .catch(() => setStatus('无法读取产物清单。'));
  }, [sessionId]);
  const exportAll = async () => {
    setSaving(true); setStatus(null);
    try {
      const response = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}/save`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error('ARTIFACT_EXPORT_FAILED');
      setStatus(`已导出到 ${body.destination}`);
    } catch { setStatus('产物导出失败。'); } finally { setSaving(false); }
  };
  return <div className="save-file-panel">
    <p>本次会话生成了 {artifacts.length} 个产物，将作为一组保存并附带校验清单。</p>
    <ul>{artifacts.map(item => <li key={item.relativePath}><code>{item.relativePath}</code>（{item.size} bytes）</li>)}</ul>
    <button className="btn btn-secondary" onClick={() => void exportAll()} disabled={saving || artifacts.length === 0}>
      {saving ? '正在导出…' : '导出全部产物'}
    </button>
    {status && <div role="status" className="save-status">{status}</div>}
  </div>;
}
