import React, { useState, useEffect } from 'react';

interface ConfigStatus {
  hasKey: boolean;
  source: string;
}

interface GuideInfo {
  needsSetup: boolean;
  message: string;
  instructions: string[];
}

export function ConfigPage() {
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [guide, setGuide] = useState<GuideInfo | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ valid: boolean; error?: string } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/config/status').then(r => {
        if (r.status === 403) throw new Error('CONFIG_DISABLED');
        return r.json();
      }),
      fetch('/api/config/guide').then(r => {
        if (r.status === 403) throw new Error('CONFIG_DISABLED');
        return r.json();
      }),
    ]).then(([s, g]) => {
      setStatus(s);
      setGuide(g);
      setLoading(false);
    }).catch(err => {
      if (err.message === 'CONFIG_DISABLED') {
        setMessage({ type: 'info', text: '配置页面仅在本地模式下可用。当前为公开安全模式，无需配置 API Key。' });
      } else {
        setMessage({ type: 'error', text: '无法连接到服务器' });
      }
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setMessage({ type: 'error', text: '请输入 API Key' });
      return;
    }
    try {
      const res = await fetch('/api/config/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: 'API Key 已安全保存（加密存储）' });
        setApiKey('');
        setStatus({ hasKey: true, source: 'file' });
      } else {
        setMessage({ type: 'error', text: data.error || '保存失败' });
      }
    } catch {
      setMessage({ type: 'error', text: '网络错误' });
    }
  };

  const handleDelete = async () => {
    try {
      await fetch('/api/config/key', { method: 'DELETE' });
      setMessage({ type: 'info', text: 'API Key 已清除' });
      setStatus({ hasKey: false, source: 'none' });
      setTestResult(null);
    } catch {
      setMessage({ type: 'error', text: '删除失败' });
    }
  };

  const handleTestKey = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/agent/test-key', { method: 'POST' });
      const data = await res.json();
      setTestResult(data);
      if (data.valid) {
        setMessage({ type: 'success', text: 'API Key 有效！DeepSeek API 连接正常。' });
      } else {
        setMessage({ type: 'error', text: `Key 验证失败：${data.error}` });
      }
    } catch {
      setTestResult({ valid: false, error: '网络错误' });
      setMessage({ type: 'error', text: '无法测试 API Key' });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div className="loading-text">加载配置中...</div>;
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <h2 className="section-title">配置</h2>

      {/* 状态卡片 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>API Key 状态</span>
          <span className={`badge ${status?.hasKey ? 'badge-completed' : 'badge-blocked'}`}>
            {status?.hasKey ? '已配置' : '未设置'}
          </span>
        </div>
        {status?.source === 'env' && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
            Key 从 DEEPSEEK_API_KEY 环境变量加载
          </div>
        )}
        {status?.source === 'file' && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
            Key 已加密存储在本地文件中
          </div>
        )}
      </div>

      {/* 引导卡片 */}
      {guide && guide.needsSetup && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--color-warning)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>首次使用引导</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            {guide.instructions.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      )}

      {/* Key 输入卡片 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>设置 API Key</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            className="input"
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="输入你的 DeepSeek API Key"
            style={{ fontFamily: showKey ? 'monospace' : undefined }}
          />
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowKey(!showKey)}
            title={showKey ? '隐藏 Key' : '显示 Key'}
          >
            {showKey ? '隐藏' : '显示'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={!apiKey.trim()}>
            保存 Key
          </button>
          <button className="btn btn-secondary" onClick={handleTestKey} disabled={testing}>
            {testing ? '测试中...' : '测试连接'}
          </button>
          {status?.hasKey && status?.source === 'file' && (
            <button className="btn btn-danger" onClick={handleDelete}>
              清除 Key
            </button>
          )}
        </div>
      </div>

      {/* 测试结果 */}
      {testResult && (
        <div className="card" style={{ marginBottom: 16, borderLeft: `3px solid ${testResult.valid ? 'var(--color-success)' : 'var(--color-danger)'}` }}>
          <div style={{ fontWeight: 600, color: testResult.valid ? 'var(--color-success)' : 'var(--color-danger)' }}>
            {testResult.valid ? '✅ 连接成功' : '❌ 连接失败'}
          </div>
          {testResult.error && (
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
              {testResult.error}
            </div>
          )}
        </div>
      )}

      {/* 提示消息 */}
      {message && (
        <div className="card" style={{
          borderLeft: `3px solid ${
            message.type === 'success' ? 'var(--color-success)' :
            message.type === 'error' ? 'var(--color-danger)' : 'var(--color-info)'
          }`,
          fontSize: 13,
          color: 'var(--color-text-secondary)',
          marginBottom: 16,
        }}>
          {message.text}
        </div>
      )}

      {/* 安全说明 */}
      <div className="card" style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
        <strong>凭据存储说明：</strong>
        <ul style={{ marginTop: 8, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>Key 使用 AES-256-GCM 加密后写入磁盘</li>
          <li>加密文件位置：<code>~/.harness/credentials.enc</code></li>
          <li>加密密钥由你的机器主机名 + 用户名派生</li>
          <li>生产环境建议使用 <code>DEEPSEEK_API_KEY</code> 环境变量</li>
          <li>Key 不会写入日志、API 响应、或 Git 历史</li>
        </ul>
      </div>
    </div>
  );
}