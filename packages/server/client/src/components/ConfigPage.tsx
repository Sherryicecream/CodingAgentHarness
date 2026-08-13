import React, { useEffect, useState } from 'react';
import type { RuntimeMode } from '../hooks/useRuntimeInfo.js';

interface CredentialStatus {
  storage: 'memory' | 'keyring' | 'unavailable';
  hasKey: boolean;
}

export function ConfigPage({ mode }: { mode: RuntimeMode }) {
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);

  const refresh = async () => {
    const response = await fetch('/api/config/status');
    if (!response.ok) throw new Error('STATUS_FAILED');
    setStatus(await response.json() as CredentialStatus);
  };

  useEffect(() => {
    if (mode === 'local') void refresh().catch(() => setMessage('无法读取系统凭据状态。'));
    return () => setApiKey('');
  }, [mode]);

  if (mode === 'public') {
    return <div className="card"><h2>本地配置</h2><p>在线演示不会接收或保存 API Key。</p></div>;
  }
  if (!status) return <div className="loading-text">正在读取系统凭据…</div>;

  const save = async () => {
    if (!apiKey.trim()) return setMessage('请输入 DeepSeek API Key。');
    try {
      const response = await fetch('/api/config/key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey.trim() }),
      });
      setApiKey('');
      if (!response.ok) return setMessage('系统凭据库不可用；请在对话页选择“仅本次使用”。');
      setMessage('API Key 已安全保存在当前操作系统账户中。');
      await refresh();
    } catch {
      setApiKey('');
      setMessage('保存失败；请在对话页选择“仅本次使用”。');
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const response = await fetch('/api/agent/test-key', { method: 'POST' });
      const body = await response.json() as { valid?: boolean; error?: string };
      const explanations: Record<string, string> = {
        API_KEY_NOT_CONFIGURED: '尚未保存 API Key。',
        API_KEY_INVALID: 'API Key 无效或无权访问 DeepSeek。',
        API_BILLING_REQUIRED: '账户余额或计费状态不可用。',
        API_RATE_LIMITED: '请求过于频繁，请稍后重试。',
        API_SERVICE_UNAVAILABLE: 'DeepSeek 服务暂时不可用。',
        API_CONNECTION_FAILED: '无法连接 DeepSeek；请检查网络、代理、DNS 或 TLS。',
        API_REQUEST_REJECTED: 'DeepSeek 拒绝了认证检查。',
      };
      setMessage(body.valid ? '连接测试成功。' : `连接测试失败：${explanations[body.error ?? ''] ?? '未知错误'}`);
    } catch {
      setMessage('连接测试失败：无法连接本地服务。');
    } finally {
      setTesting(false);
    }
  };

  const clear = async () => {
    const response = await fetch('/api/config/key', { method: 'DELETE' });
    setMessage(response.ok ? '已从系统凭据库删除 API Key。' : '删除失败。');
    if (response.ok) await refresh();
  };

  return <div style={{ maxWidth: 600, margin: '0 auto' }}>
    <h2 className="section-title">DeepSeek 配置</h2>
    <div className="card">
      <h3>选择使用方式</h3>
      <p>仅本次使用：在对话页输入，运行结束后清除。</p>
      <p>记住在此设备：保存到 Windows Credential Manager、macOS Keychain 或 Linux Secret Service。</p>
      <p>当前状态：{status.storage === 'unavailable' ? '系统凭据库不可用' : status.hasKey ? '已记住在此设备' : '尚未保存'}</p>
    </div>
    {status.storage !== 'unavailable' && <div className="card">
      <label htmlFor="deepseek-api-key">DeepSeek API Key（不会回显）</label>
      <input id="deepseek-api-key" className="input" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" />
      <button className="btn btn-primary" onClick={() => void save()}>记住在此设备</button>
      {status.hasKey && <><button className="btn btn-secondary" onClick={() => void testConnection()} disabled={testing}>测试连接</button><button className="btn btn-danger" onClick={() => void clear()}>删除已保存的 Key</button></>}
    </div>}
    {message && <div className="card" role="status">{message}</div>}
  </div>;
}
