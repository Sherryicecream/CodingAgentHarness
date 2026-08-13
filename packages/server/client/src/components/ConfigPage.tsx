import React, { useEffect, useState } from 'react';
import type { RuntimeMode } from '../hooks/useRuntimeInfo.js';

type State = 'empty' | 'legacy' | 'locked' | 'unlocked';
interface Status { hasKey: boolean; source: string; state: State }
const validPassword = (value: string) => value.length >= 12 && value.length <= 128;

export function ConfigPage({ mode }: { mode: RuntimeMode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [key, setKey] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const refresh = async () => { const response = await fetch('/api/config/status'); if (response.ok) setStatus(await response.json() as Status); };
  useEffect(() => { if (mode !== 'public') void refresh().catch(() => setMessage('无法连接本地服务，请确认服务器正在运行。')); }, [mode]);
  if (mode === 'public') return <div className="card"><h2>本地配置</h2><p>公共演示模式不会接收或保存 API Key。</p></div>;
  if (!status) return <div className="loading-text">正在加载配置…</div>;
  const firstSetup = status.state === 'empty' || status.state === 'legacy';
  const save = async () => {
    if (!key.trim()) return setMessage('保存失败：请输入 DeepSeek API Key。');
    if (firstSetup && !validPassword(password)) return setMessage('保存失败：主密码需为 12–128 个字符。');
    try {
      const response = await fetch('/api/config/key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: key.trim(), ...(firstSetup ? { masterPassword: password } : {}) }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return setMessage(`保存失败：${body.error || '服务器拒绝了请求。'}`);
      setKey(''); setPassword(''); setMessage('已保存 DeepSeek API Key。下一步：测试连接。'); await refresh();
    } catch { setMessage('保存失败：无法连接本地服务。'); }
  };
  const unlock = async () => {
    if (!password) return setMessage('解锁失败：请输入主密码。');
    try { const response = await fetch('/api/config/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ masterPassword: password }) }); if (!response.ok) return setMessage('解锁失败：主密码不正确。'); setPassword(''); setMessage('凭据已解锁。下一步：输入或更新 API Key。'); await refresh(); } catch { setMessage('解锁失败：无法连接本地服务。'); }
  };
  const testConnection = async () => {
    setTesting(true);
    try { const response = await fetch('/api/agent/test-key', { method: 'POST' }); const body = await response.json().catch(() => ({})); setMessage(response.ok && body.valid ? '连接测试成功。' : `连接测试失败：${body.error || `HTTP ${response.status}`}`); }
    catch { setMessage('连接测试失败：无法连接 DeepSeek，请检查网络或 API Key。'); }
    finally { setTesting(false); }
  };
  const clear = async () => { const response = await fetch('/api/config/key', { method: 'DELETE' }); setMessage(response.ok ? 'DeepSeek 配置已删除。' : '删除失败：请先解锁凭据。'); if (response.ok) await refresh(); };
  return <div style={{ maxWidth: 600, margin: '0 auto' }}><h2 className="section-title">DeepSeek 配置</h2>
    <div className="card"><h3>第 1 步：准备本地凭据</h3><p>主密码只用于加密本地 API Key，不会上传或回显。</p>{status.state === 'locked' ? <><label htmlFor="master-password">输入主密码以解锁</label><input id="master-password" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} /><button className="btn btn-primary" onClick={() => void unlock()}>解锁凭据</button></> : <p>凭据状态：{status.state === 'empty' ? '尚未设置' : '已解锁'}</p>}</div>
    {status.state !== 'locked' && <div className="card"><h3>第 2 步：保存 DeepSeek API Key</h3><p>请访问 <a href="https://platform.deepseek.com/api-keys" target="_blank" rel="noreferrer">DeepSeek 控制台</a> 创建 Key。</p><label htmlFor="deepseek-api-key">DeepSeek API Key（不会回显）</label><input id="deepseek-api-key" className="input" type="password" value={key} onChange={e => setKey(e.target.value)} />{firstSetup && <><label htmlFor="master-password">首次设置主密码（12–128 个字符）</label><input id="master-password" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} /></>}<button className="btn btn-primary" onClick={() => void save()}>保存 DeepSeek API Key</button></div>}
    {status.hasKey && <div className="card"><h3>第 3 步：测试连接</h3><p>确认 API Key 可以正常访问 DeepSeek。</p><button className="btn btn-secondary" disabled={testing} onClick={() => void testConnection()}>{testing ? '测试中…' : '测试连接'}</button><button className="btn btn-danger" onClick={() => void clear()}>删除配置</button></div>}
    {message && <div className="card" role="status">{message}</div>}
  </div>;
}
