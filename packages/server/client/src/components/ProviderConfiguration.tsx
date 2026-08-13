import React, { useEffect, useState } from 'react';

interface ProviderSummary {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}

interface ProviderConfigurationProps {
  needsMasterPassword: boolean;
  masterPassword: string;
  onMasterPasswordChange(value: string): void;
  onCredentialChange(): Promise<void>;
  onMessage(message: { type: 'success' | 'error' | 'info'; text: string }): void;
}

type ProviderLoadState = 'loading' | 'loaded' | 'error';

const fetchProviders = async (): Promise<ProviderSummary[]> => {
  const response = await fetch('/api/config/providers');
  if (!response.ok) throw new Error('无法加载 Provider');
  const body = await response.json() as { providers?: unknown };
  return Array.isArray(body.providers) ? body.providers as ProviderSummary[] : [];
};

export function ProviderConfiguration({
  needsMasterPassword,
  masterPassword,
  onMasterPasswordChange,
  onCredentialChange,
  onMessage,
}: ProviderConfigurationProps) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [providerLoadState, setProviderLoadState] = useState<ProviderLoadState>('loading');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    void fetchProviders().then((nextProviders) => {
      setProviders(nextProviders);
      setProviderLoadState('loaded');
    }).catch(() => setProviderLoadState('error'));
    return () => setApiKey('');
  }, []);

  const refresh = async () => {
    setProviderLoadState('loading');
    try {
      setProviders(await fetchProviders());
      setProviderLoadState('loaded');
    } catch {
      setProviderLoadState('error');
    }
    await onCredentialChange();
  };

  const add = async () => {
    if (!id || !name || !baseUrl || !model || !apiKey) {
      onMessage({ type: 'error', text: '请填写所有 Provider 字段' });
      return;
    }
    if (needsMasterPassword && (masterPassword.length < 12 || masterPassword.length > 128)) {
      onMessage({ type: 'error', text: '主密码需要 12-128 个字符' });
      return;
    }
    try {
      const response = await fetch('/api/config/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name,
          baseUrl,
          model,
          apiKey,
          ...(needsMasterPassword ? { masterPassword } : {}),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '添加 Provider 失败');
      setId('');
      setName('');
      setBaseUrl('');
      setModel('');
      setApiKey('');
      onMasterPasswordChange('');
      onMessage({ type: 'success', text: 'Provider 已添加' });
      await refresh();
    } catch (error) {
      setApiKey('');
      onMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '添加 Provider 失败',
      });
    }
  };

  const remove = async (provider: ProviderSummary) => {
    const response = await fetch(`/api/config/providers/${encodeURIComponent(provider.id)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      onMessage({ type: 'error', text: '删除 Provider 失败' });
      return;
    }
    onMessage({ type: 'info', text: 'Provider 已删除' });
    await refresh();
  };

  let providerList: React.ReactNode;
  if (providerLoadState === 'loading') {
    providerList = <div className="loading-text">正在加载 Provider…</div>;
  } else if (providerLoadState === 'error') {
    providerList = <div role="alert">无法加载 Provider。</div>;
  } else if (providers.length === 0) {
    providerList = <div>尚未配置其他 Provider。</div>;
  } else {
    providerList = providers.map((provider) => (
      <div key={provider.id} style={{ marginBottom: 12 }}>
        <strong>{provider.name}</strong>
        <div>{provider.baseUrl} · {provider.model}</div>
        <button
          className="btn btn-danger"
          aria-label={`删除 ${provider.name}`}
          onClick={() => void remove(provider)}
        >删除</button>
      </div>
    ));
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Provider 配置</h3>
      <p>配置兼容的 Provider。API Key 会加密保存，且不会显示。</p>
      {providerList}
      <details>
        <summary>高级 Provider 设置</summary>
        <label htmlFor="provider-id">Provider ID（唯一标识）</label>
        <input id="provider-id" className="input" value={id} onChange={(event) => setId(event.target.value)} autoComplete="off" />
        <label htmlFor="provider-name">Provider 名称</label>
        <input id="provider-name" className="input" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
        <label htmlFor="provider-base-url">服务地址（Base URL）</label>
        <input id="provider-base-url" className="input" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} autoComplete="off" />
        <label htmlFor="provider-model">模型名称</label>
        <input id="provider-model" className="input" value={model} onChange={(event) => setModel(event.target.value)} autoComplete="off" />
        <label htmlFor="provider-api-key">Provider API Key（不会回显）</label>
        <input id="provider-api-key" className="input" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" />
        <button className="btn btn-primary" onClick={() => void add()}>添加 Provider</button>
      </details>
    </div>
  );
}
