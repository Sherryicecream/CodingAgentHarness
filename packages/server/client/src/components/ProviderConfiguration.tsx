import React, { useEffect, useState } from 'react';

interface ProviderSummary { id: string; name: string; baseUrl: string; model: string; hasApiKey: boolean }
interface Props { needsMasterPassword: boolean; masterPassword: string; onMasterPasswordChange(value: string): void; onCredentialChange(): Promise<void>; onMessage(message: { type: 'success' | 'error' | 'info'; text: string }): void }
type LoadState = 'loading' | 'loaded' | 'error';

async function fetchProviders(): Promise<ProviderSummary[]> {
  const response = await fetch('/api/config/providers');
  if (!response.ok) throw new Error('无法加载服务商列表');
  const body = await response.json() as { providers?: unknown };
  return Array.isArray(body.providers) ? body.providers as ProviderSummary[] : [];
}

export function ProviderConfiguration({ needsMasterPassword, masterPassword, onMasterPasswordChange, onCredentialChange, onMessage }: Props) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [id, setId] = useState(''); const [name, setName] = useState(''); const [baseUrl, setBaseUrl] = useState(''); const [model, setModel] = useState(''); const [apiKey, setApiKey] = useState('');
  useEffect(() => { void fetchProviders().then((p) => { setProviders(p); setLoadState('loaded'); }).catch(() => setLoadState('error')); return () => setApiKey(''); }, []);
  const refresh = async () => { setLoadState('loading'); try { setProviders(await fetchProviders()); setLoadState('loaded'); } catch { setLoadState('error'); } await onCredentialChange(); };
  const add = async () => {
    if (!id || !name || !baseUrl || !model || !apiKey) return onMessage({ type: 'error', text: '请填写全部服务商信息' });
    if (needsMasterPassword && (masterPassword.length < 12 || masterPassword.length > 128)) return onMessage({ type: 'error', text: '主密码需为 12–128 个字符' });
    try { const response = await fetch('/api/config/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name, baseUrl, model, apiKey, ...(needsMasterPassword ? { masterPassword } : {}) }) }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || '添加服务商失败'); setId(''); setName(''); setBaseUrl(''); setModel(''); setApiKey(''); onMasterPasswordChange(''); onMessage({ type: 'success', text: '服务商已添加' }); await refresh(); } catch (error) { setApiKey(''); onMessage({ type: 'error', text: error instanceof Error ? error.message : '添加服务商失败' }); }
  };
  const remove = async (provider: ProviderSummary) => { const response = await fetch(`/api/config/providers/${encodeURIComponent(provider.id)}`, { method: 'DELETE' }); if (!response.ok) return onMessage({ type: 'error', text: '删除服务商失败' }); onMessage({ type: 'info', text: '服务商已删除' }); await refresh(); };
  let list: React.ReactNode = loadState === 'loading' ? <div className="loading-text">正在加载服务商…</div> : loadState === 'error' ? <div role="alert">无法加载服务商，请检查本地服务</div> : providers.length === 0 ? <div>还没有添加其他服务商</div> : providers.map((p) => <div key={p.id} style={{ marginBottom: 12 }}><strong>{p.name}</strong><div>{p.baseUrl} · {p.model}</div><button className="btn btn-danger" aria-label={`删除 ${p.name}`} onClick={() => void remove(p)}>删除</button></div>);
  return <div className="card" style={{ marginTop: 16 }}><h3>服务商配置</h3><p>可添加兼容服务商。API Key 只加密保存，不会回显。</p>{list}<details><summary>添加服务商（高级）</summary><label htmlFor="provider-id">唯一 ID</label><input id="provider-id" className="input" value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" /><label htmlFor="provider-name">名称</label><input id="provider-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /><label htmlFor="provider-base-url">接口地址</label><input id="provider-base-url" className="input" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} autoComplete="off" /><label htmlFor="provider-model">模型名称</label><input id="provider-model" className="input" value={model} onChange={(e) => setModel(e.target.value)} autoComplete="off" /><label htmlFor="provider-api-key">API Key（不会回显）</label><input id="provider-api-key" className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" /><button className="btn btn-primary" onClick={() => void add()}>添加服务商</button></details></div>;
}
