import React, { useEffect, useState } from 'react';
import type { RuntimeMode } from '../hooks/useRuntimeInfo.js';
type State = 'empty' | 'legacy' | 'locked' | 'unlocked';
interface Status { hasKey: boolean; source: string; state: State }
const validPassword = (value: string) => value.length >= 12 && value.length <= 128;

export function ConfigPage({ mode }: { mode: RuntimeMode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const refresh = async () => { const response = await fetch('/api/config/status'); if (response.ok) setStatus(await response.json() as Status); };
  useEffect(() => { if (mode !== 'public') void refresh().catch(() => setMessage('无法连接本地服务，请确认服务器正在运行。')); }, [mode]);
  if (mode === 'public') return <div className="card"><h2>本地配置</h2><p>公共演示模式不会接收或保存 API Key。</p></div>;
  if (!status) return <div className="loading-text">正在加载配置…</div>;
  const firstSetup = status.state === 'empty' || status.state === 'legacy';
  const locked = status.state === 'locked';
  const post = (path: string, body: unknown) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const save = async () => {
    if (!apiKey.trim()) return setMessage('保存失败：请输入 DeepSeek API Key。');
    if (firstSetup && !validPassword(password)) return setMessage('保存失败：主密码需要 12–128 个字符。');
    if (firstSetup && password !== confirmation) return setMessage('保存失败：两次输入的主密码不一致。');
    try { const response = await post('/api/config/key', { key: apiKey.trim(), ...(firstSetup ? { masterPassword: password } : {}) }); const body = await response.json().catch(() => ({})); if (!response.ok) return setMessage(`保存失败：${body.error ?? '服务器拒绝了请求。'}`); setApiKey(''); setPassword(''); setConfirmation(''); setMessage('DeepSeek API Key 已保存。下一步：测试连接。'); await refresh(); } catch { setMessage('保存失败：无法连接本地服务。'); }
  };
  const unlock = async () => { try { const response = await post('/api/config/unlock', { masterPassword: password }); setMessage(response.ok ? '凭据已解锁。下一步：测试连接。' : '解锁失败：主密码不正确。'); if (response.ok) { setPassword(''); await refresh(); } } catch { setMessage('解锁失败：无法连接本地服务。'); } };
  const testConnection = async () => { setTesting(true); try { const response = await fetch('/api/agent/test-key', { method: 'POST' }); const body = await response.json().catch(() => ({})); setMessage(body.valid ? '连接测试成功：DeepSeek API 可用。' : `连接测试失败：${body.error ?? '请检查 API Key、网络或服务地址。'}`); } catch { setMessage('连接测试失败：无法连接本地服务。'); } finally { setTesting(false); } };
  const clear = async () => { try { const response = await fetch('/api/config/key', { method: 'DELETE' }); setMessage(response.ok ? 'DeepSeek 配置已删除。请重新输入 API Key；无需再次设置主密码。' : '删除失败：请先解锁凭据。'); if (response.ok) await refresh(); } catch { setMessage('删除失败：无法连接本地服务。'); } };
  return <div style={{ maxWidth: 600, margin: '0 auto' }}><h2 className="section-title">DeepSeek 配置</h2><div className="card"><h3>第 1 步：凭据状态</h3><p>主密码只用于本地加密 API Key，不会上传或回显。</p><p>当前状态：{locked ? '已锁定，请解锁' : status.hasKey ? '已配置' : firstSetup ? '尚未初始化' : '已解锁，等待 API Key'}</p></div>{status.hasKey && locked && <div className="card"><h3>第 2 步：解锁凭据</h3><label htmlFor="master-password">主密码</label><input id="master-password" className="input" type="password" value={password} onChange={event => setPassword(event.target.value)} /><button className="btn btn-primary" onClick={() => void unlock()}>解锁凭据</button></div>}{!status.hasKey && !locked && <div className="card"><h3>第 2 步：{firstSetup ? '设置密码并保存 API Key' : '保存新的 API Key'}</h3><p>请访问 <a href="https://platform.deepseek.com/api-keys" target="_blank" rel="noreferrer">DeepSeek 控制台</a> 创建 Key。</p><label htmlFor="deepseek-api-key">DeepSeek API Key（不会回显）</label><input id="deepseek-api-key" className="input" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} />{firstSetup && <><label htmlFor="master-password">设置主密码（12–128 个字符）</label><input id="master-password" className="input" type="password" value={password} onChange={event => setPassword(event.target.value)} /><label htmlFor="master-password-confirmation">再次确认主密码</label><input id="master-password-confirmation" className="input" type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></>}<button className="btn btn-primary" onClick={() => void save()}>保存 DeepSeek API Key</button></div>}{status.hasKey && !locked && <div className="card"><h3>第 3 步：测试连接</h3><p>确认 API Key 可以正常访问 DeepSeek。</p><button className="btn btn-secondary" onClick={() => void testConnection()} disabled={testing}>测试连接</button><button className="btn btn-danger" onClick={() => void clear()}>删除配置</button></div>}{message && <div className="card" role="status">{message}</div>}</div>;
}
