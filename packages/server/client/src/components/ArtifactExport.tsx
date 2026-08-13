import React, { useEffect, useState } from 'react';

interface ArtifactRecord { relativePath: string; size: number; sha256: string }

export function ArtifactExport({ sessionId }: { readonly sessionId: string }) {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ approvalToken: string; changes: Array<{ relativePath: string; operation: string; dangerous: boolean; before?: string; after?: string }> } | null>(null);
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
  const previewApply = async () => {
    setStatus(null);
    const response = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}/apply/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return setStatus('请先导出全部产物，再预览项目变更。');
    setPreview(body);
  };
  const applyApproved = async () => {
    if (!preview) return;
    const response = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}/apply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approvalToken: preview.approvalToken }),
    });
    setPreview(null);
    setStatus(response.ok ? '变更已应用到本地项目。' : '批准已失效；请重新预览。');
  };
  return <div className="save-file-panel">
    <p>本次会话生成了 {artifacts.length} 个产物，将作为一组保存并附带校验清单。</p>
    <ul>{artifacts.map(item => <li key={item.relativePath}><code>{item.relativePath}</code>（{item.size} bytes）</li>)}</ul>
    <button className="btn btn-secondary" onClick={() => void exportAll()} disabled={saving || artifacts.length === 0}>
      {saving ? '正在导出…' : '导出全部产物'}
    </button>
    <button className="btn btn-secondary" onClick={() => void previewApply()} disabled={saving || artifacts.length === 0}>预览并应用到项目</button>
    {preview && <div className="card" role="dialog" aria-label="项目变更预览">
      <h3>确认项目变更</h3>
      <ul>{preview.changes.map(change => <li key={change.relativePath}>
        <code>{change.relativePath}</code> — {change.operation === 'replace' ? '替换现有文件（危险）' : '创建新文件'}
        {change.before !== undefined && change.after !== undefined && <details><summary>查看内容</summary><pre>- {change.before}{'\n'}+ {change.after}</pre></details>}
      </li>)}</ul>
      <button className="btn btn-primary" onClick={() => void applyApproved()}>批准并应用</button>
      <button className="btn btn-secondary" onClick={() => setPreview(null)}>取消</button>
    </div>}
    {status && <div role="status" className="save-status">{status}</div>}
  </div>;
}
