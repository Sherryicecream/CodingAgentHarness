import React, { useEffect, useState } from 'react';
import type { RuntimeMode } from '../hooks/useRuntimeInfo.js';

type State = 'empty' | 'legacy' | 'locked' | 'unlocked';
interface Status { hasKey: boolean; source: string; state: State }

const passwordIsValid = (value: string) => value.length >= 12 && value.length <= 128;

export function ConfigPage({ mode }: { mode: RuntimeMode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);

  const refresh = async () => {
    const response = await fetch('/api/config/status');
    if (response.ok) setStatus(await response.json() as Status);
  };

  useEffect(() => {
    if (mode !== 'public') void refresh().catch(() => setMessage('无法连接本地服务，请确认服务器正在运行。'));
  }, [mode]);

  if (mode === 'public') return <div className="card"><h2>本地配置</h2><p>公共演示模式不会接收或保存 API Key。</p></div>;
  if (!status) return <div className="loading-text">正在加载配置…</div>;

  const firstSetup = status.state === 'empty' || status.state === 'legacy';
  const locked = status.state === 'locked';
  const post = (path: string, body: unknown) => fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  const save = async () => {
    if (!apiKey.trim()) return setMessage('保存失败：请输入 DeepSeek API Key。');
    if (firstSetup && !passwordIsValid(password)) return setMessage('保存失败：主密码需要 12–128 个字符。');
    try {
      const response = await post('/api/config/key', { key: apiKey.trim(), ...(firstSetup ? { masterPassword: password } : {}) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return setMessage(`保存失败：${body.error ?? '服务器拒绝了请求。'}`);
      setApiKey(''); setPassword(''); setMessage('已保存 DeepSeek API Key。下一步：测试连接。'); await refresh();
    } catch { setMessage('保存失败：无法连接本地服务。'); }
  };

  const unlock = async () => {
    const response = await post('/api/config/unlock', { masterPassword: password });
    setMessage(response.ok ? '凭据已解锁。下一步：测试连接。' : '解锁失败：主密码不正确。');
    if (response.ok) { setPassword(''); await refresh(); }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const response = await fetch('/api/agent/test-key', { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      setMessage(body.valid ? '连接测试成功：DeepSeek API 可用。' : `连接测试失败：${body.error ?? '请检查 API Key。'}`);
    } catch { setMessage('连接测试失败：无法连接本地服务。'); }
    finally { setTesting(false); }
  };

  const clear = async () => {
    const response = await fetch('/api/config/key', { method: 'DELETE' });
    setMessage(response.ok ? 'DeepSeek 配置已删除。' : '删除失败：请先解锁凭据。');
    if (response.ok) await refresh();
  };

  return <div style={{ maxWidth: 600, margin: '0 auto' }}>
    <h2 className="section-title">DeepSeek 配置</h2>
    <div className="card"><h3>第 1 步：准备本地凭据</h3><p>主密码是本地加密保险箱密码，只用于保护 API Key，不会上传或回显。</p><p>当前状态：{locked ? '已锁定，请解锁' : status.hasKey ? '已配置' : '尚未配置'}</p></div>
    {firstSetup && <div className="card"><h3>第 2 步：保存 API Key</h3><p>请访问 <a href="https://platform.deepseek.com/api-keys" target="_blank" rel="noreferrer">DeepSeek 控制台</a> 创建 Key。</p><label htmlFor="deepseek-api-key">DeepSeek API Key（不会回显）</label><input id="deepseek-api-key" className="input" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} /><label htmlFor="master-password">首次设置主密码（12–128 个字符）</label><input id="master-password" className="input" type="password" value={password} onChange={event => setPassword(event.target.value)} /><button className="btn btn-primary" onClick={() => void save()}>保存 DeepSeek API Key</button></div>}
    {locked && <div className="card"><h3>第 2 步：解锁凭据</h3><label htmlFor="master-password">主密码</label><input id="master-password" className="input" type="password" value={password} onChange={event => setPassword(event.target.value)} /><button className="btn btn-primary" onClick={() => void unlock()}>解锁凭据</button></div>}
    {status.hasKey && !locked && <div className="card"><h3>第 3 步：测试连接</h3><p>确认 API Key 可以正常访问 DeepSeek。</p><button className="btn btn-secondary" onClick={() => void testConnection()} disabled={testing}>测试连接</button><button className="btn btn-danger" onClick={() => void clear()}>删除配置</button></div>}
    {message && <div className="card" role="status">{message}</div>}
  </div>;
}
