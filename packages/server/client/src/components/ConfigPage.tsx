import React, { useEffect, useState } from 'react';
import type { RuntimeMode } from '../hooks/useRuntimeInfo.js';

type State = 'empty' | 'legacy' | 'locked' | 'unlocked';
interface Status { hasKey: boolean; source: string; state: State }
interface Props { mode: RuntimeMode }
const validPassword = (v: string) => v.length >= 12 && v.length <= 128;

export function ConfigPage({ mode }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [key, setKey] = useState(''); const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null); const [testing, setTesting] = useState(false);
  const refresh = async () => { const r = await fetch('/api/config/status'); if (r.ok) setStatus(await r.json()); };
  useEffect(() => { if (mode === 'public') return; void Promise.all([fetch('/api/config/status'), fetch('/api/config/guide')]).then(async ([s, g]) => { setStatus(await s.json()); }).catch(() => setMessage('无法连接服务器')); }, [mode]);
  if (mode === 'public') return <div className="card"><h2>本地配置</h2><p>公共演示不会接收或保存 API Key。请在本地可信模式运行。</p></div>;
  if (!status) return <div className="loading-text">正在加载配置…</div>;
  const state = status.state; const needsPassword = state === 'empty' || state === 'legacy';
  const post = (path: string, body?: unknown) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const save = async () => { if (!key.trim()) return setMessage('请输入 DeepSeek API Key'); if (needsPassword && !validPassword(password)) return setMessage('主密码需要 12–128 个字符'); const r = await post('/api/config/key', { key: key.trim(), ...(needsPassword ? { masterPassword: password } : {}) }); const d = await r.json().catch(() => ({})); if (!r.ok) return setMessage(d.error ?? '保存失败'); setKey(''); setPassword(''); setMessage('DeepSeek API Key 已安全保存'); await refresh(); };
  const unlock = async () => { const r = await post('/api/config/unlock', { masterPassword: password }); setMessage(r.ok ? '凭据已解锁' : '主密码错误'); if (r.ok) { setPassword(''); await refresh(); } };
  const test = async () => { setTesting(true); try { const r = await fetch('/api/agent/test-key', { method: 'POST' }); const d = await r.json(); setMessage(d.valid ? 'DeepSeek 连接测试成功' : `连接测试失败：${d.error ?? '未知错误'}`); } catch { setMessage('无法测试 DeepSeek 连接'); } finally { setTesting(false); } };
  const clear = async () => { const r = await fetch('/api/config/key', { method: 'DELETE' }); setMessage(r.ok ? 'DeepSeek 配置已删除' : '删除失败，请先解锁凭据'); if (r.ok) await refresh(); };
  return <div style={{ maxWidth: 600, margin: '0 auto' }}><h2 className="section-title">DeepSeek 配置</h2><div className="card"><strong>API Key 状态：</strong>{status.hasKey ? '已配置' : '未配置'}{status.source === 'env' && <p>当前使用 DEEPSEEK_API_KEY 环境变量。</p>}</div>{needsPassword && <div className="card"><p>首次保存需要设置主密码。主密码用于加密本地凭据，不会写入浏览器或日志；忘记后只能删除并重新配置。</p></div>}{state === 'locked' && <div className="card"><label htmlFor="master-password">主密码</label><input id="master-password" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} /><button className="btn btn-primary" onClick={() => void unlock()}>解锁凭据</button></div>}{state !== 'locked' && <div className="card"><label htmlFor="deepseek-api-key">DeepSeek API Key（不会回显）</label><input id="deepseek-api-key" className="input" type="password" value={key} onChange={e => setKey(e.target.value)} />{needsPassword && <><label htmlFor="master-password">首次设置主密码（12–128 个字符）</label><input id="master-password" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} /></>}<button className="btn btn-primary" onClick={() => void save()}>保存 DeepSeek Key</button>{state === 'unlocked' && <><button className="btn btn-secondary" onClick={() => void test()} disabled={testing}>测试连接</button><button className="btn btn-danger" onClick={() => void clear()}>删除配置</button></>}</div>}{message && <div className="card" role="status">{message}</div>}</div>;
}
