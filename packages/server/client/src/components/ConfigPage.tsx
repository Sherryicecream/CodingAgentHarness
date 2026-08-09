import React, { useEffect, useState } from 'react';
import type { RuntimeMode } from '../hooks/useRuntimeInfo.js';

type CredentialState = 'empty' | 'legacy' | 'locked' | 'unlocked';

interface ConfigStatus {
  hasKey: boolean;
  source: string;
  state: CredentialState;
}

interface GuideInfo {
  needsSetup: boolean;
  message: string;
  instructions: string[];
}

interface ConfigPageProps { mode: RuntimeMode }

const isPasswordValid = (value: string): boolean => value.length >= 12 && value.length <= 128;

export function ConfigPage({ mode }: ConfigPageProps) {
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [guide, setGuide] = useState<GuideInfo | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ valid: boolean; error?: string } | null>(null);

  useEffect(() => {
    if (mode === 'public') {
      setLoading(false);
      return;
    }
    Promise.all([
      fetch('/api/config/status').then((response) => response.json()),
      fetch('/api/config/guide').then((response) => response.json()),
    ]).then(([nextStatus, nextGuide]) => {
      setStatus(nextStatus as ConfigStatus);
      setGuide(nextGuide as GuideInfo);
    }).catch(() => {
      setMessage({ type: 'error', text: '无法连接到服务器' });
    }).finally(() => setLoading(false));
  }, [mode]);

  useEffect(() => () => {
    setApiKey('');
    setMasterPassword('');
  }, []);

  if (mode === 'public') {
    return (
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <h2 className="section-title">配置</h2>
        <div className="card" role="note">
          配置页面仅在本地模式下可用。公网安全演示不接收或保存 API Key；请在本机运行完整项目并设置 <code>HARNESS_MODE=local</code>。
        </div>
      </div>
    );
  }

  if (loading) return <div className="loading-text">加载配置中...</div>;

  const state = status?.state ?? (status?.hasKey ? 'unlocked' : 'empty');
  const needsMasterPassword = state === 'empty' || state === 'legacy';
  const post = async (path: string, body?: unknown): Promise<Response> => fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const refreshStatus = async () => {
    const response = await fetch('/api/config/status');
    if (response.ok) setStatus(await response.json() as ConfigStatus);
  };

  const saveKey = async () => {
    if (!apiKey.trim()) {
      setMessage({ type: 'error', text: '请输入 API Key' });
      return;
    }
    if (needsMasterPassword && !isPasswordValid(masterPassword)) {
      setMessage({ type: 'error', text: '主密码需要 12-128 个字符' });
      return;
    }
    try {
      const response = await post('/api/config/key', {
        key: apiKey.trim(),
        ...(needsMasterPassword ? { masterPassword } : {}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '保存失败');
      setApiKey('');
      setMasterPassword('');
      setMessage({ type: 'success', text: 'API Key 已安全保存' });
      await refreshStatus();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '保存失败' });
    }
  };

  const unlock = async () => {
    const response = await post('/api/config/unlock', { masterPassword });
    if (response.ok) {
      setMasterPassword('');
      setMessage({ type: 'success', text: '凭据已解锁' });
      await refreshStatus();
    } else {
      setMessage({ type: 'error', text: '主密码错误' });
    }
  };

  const lock = async () => {
    await post('/api/config/lock');
    setApiKey('');
    setMasterPassword('');
    setMessage({ type: 'info', text: '凭据已锁定' });
    await refreshStatus();
  };

  const clearKey = async () => {
    const response = await fetch('/api/config/key', { method: 'DELETE' });
    if (response.ok) {
      setMessage({ type: 'info', text: 'API Key 已清除' });
      await refreshStatus();
    } else setMessage({ type: 'error', text: '清除失败，请先解锁凭据' });
  };

  const testKey = async () => {
    setTesting(true);
    try {
      const response = await fetch('/api/agent/test-key', { method: 'POST' });
      const data = await response.json();
      setTestResult(data);
      setMessage({ type: data.valid ? 'success' : 'error', text: data.valid ? 'API Key 连接正常' : `Key 验证失败：${data.error}` });
    } catch {
      setTestResult({ valid: false, error: '网络错误' });
      setMessage({ type: 'error', text: '无法测试 API Key' });
    } finally { setTesting(false); }
  };

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <h2 className="section-title">配置</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        <strong>API Key 状态</strong>：{status?.hasKey ? '已配置' : '未配置'}（{state}）
        {status?.source === 'env' && <div>Key 来自 DEEPSEEK_API_KEY 环境变量。</div>}
      </div>
      {guide?.needsSetup && (
        <div className="card" style={{ marginBottom: 16 }}>
          {guide.instructions.map((line) => <div key={line}>{line}</div>)}
        </div>
      )}
      {state === 'locked' && (
        <div className="card">
          <label htmlFor="master-password">主密码</label>
          <input id="master-password" className="input" type="password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} autoComplete="off" />
          <button className="btn btn-primary" onClick={() => void unlock()} disabled={!masterPassword}>解锁凭据</button>
        </div>
      )}
      {(state === 'empty' || state === 'legacy' || state === 'unlocked') && (
        <div className="card">
          <label htmlFor="deepseek-api-key">DeepSeek API Key</label>
          <input id="deepseek-api-key" className="input" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" />
          {needsMasterPassword && <>
            <label htmlFor="master-password">主密码（至少 12 个字符）</label>
            <input id="master-password" className="input" type="password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} autoComplete="new-password" />
          </>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={() => void saveKey()} disabled={!apiKey}>保存 Key</button>
            {state === 'unlocked' && <>
              <button className="btn btn-secondary" onClick={() => void testKey()} disabled={testing}>测试连接</button>
              <button className="btn btn-secondary" onClick={() => void lock()}>锁定</button>
              <button className="btn btn-danger" onClick={() => void clearKey()}>清除 Key</button>
            </>}
          </div>
        </div>
      )}
      {message && <div className="card" role="status">{message.text}</div>}
      {testResult && <div className="card">{testResult.valid ? '连接成功' : `连接失败：${testResult.error ?? ''}`}</div>}
      <div className="card" style={{ marginTop: 16 }}>
        主密码只用于解锁本机加密凭据，不会写入浏览器或日志。忘记主密码后无法恢复密钥，只能清除并重新配置。
      </div>
    </div>
  );
}
