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
      fetch('/api/config/status').then(r => r.json()),
      fetch('/api/config/guide').then(r => r.json()),
    ]).then(([s, g]) => {
      setStatus(s);
      setGuide(g);
      setLoading(false);
    }).catch(() => {
      setMessage({ type: 'error', text: 'Failed to connect to server' });
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setMessage({ type: 'error', text: 'Please enter an API key' });
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
        setMessage({ type: 'success', text: 'API key saved successfully (encrypted)' });
        setApiKey('');
        setStatus({ hasKey: true, source: 'file' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save key' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    }
  };

  const handleDelete = async () => {
    try {
      await fetch('/api/config/key', { method: 'DELETE' });
      setMessage({ type: 'info', text: 'API key removed' });
      setStatus({ hasKey: false, source: 'none' });
      setTestResult(null);
    } catch {
      setMessage({ type: 'error', text: 'Failed to remove key' });
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
        setMessage({ type: 'success', text: 'API key is valid! DeepSeek API is reachable.' });
      } else {
        setMessage({ type: 'error', text: `Key validation failed: ${data.error}` });
      }
    } catch {
      setTestResult({ valid: false, error: 'Network error' });
      setMessage({ type: 'error', text: 'Failed to test API key' });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div className="loading-text">Loading configuration...</div>;
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <h2 className="section-title">Configuration</h2>

      {/* Status Card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>API Key Status</span>
          <span className={`badge ${status?.hasKey ? 'badge-completed' : 'badge-blocked'}`}>
            {status?.hasKey ? 'Configured' : 'Not Set'}
          </span>
        </div>
        {status?.source === 'env' && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
            Key loaded from DEEPSEEK_API_KEY environment variable
          </div>
        )}
        {status?.source === 'file' && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
            Key stored in encrypted credential file
          </div>
        )}
      </div>

      {/* Guide Card */}
      {guide && guide.needsSetup && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--color-warning)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>First-Time Setup Guide</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            {guide.instructions.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      )}

      {/* Key Input Card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Set API Key</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            className="input"
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="Enter your DeepSeek API key"
            style={{ fontFamily: showKey ? 'monospace' : undefined }}
          />
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowKey(!showKey)}
            title={showKey ? 'Hide key' : 'Show key'}
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={!apiKey.trim()}>
            Save Key
          </button>
          <button className="btn btn-secondary" onClick={handleTestKey} disabled={testing}>
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          {status?.hasKey && status?.source === 'file' && (
            <button className="btn btn-danger" onClick={handleDelete}>
              Remove Key
            </button>
          )}
        </div>
      </div>

      {/* Test Result */}
      {testResult && (
        <div className="card" style={{ marginBottom: 16, borderLeft: `3px solid ${testResult.valid ? 'var(--color-success)' : 'var(--color-danger)'}` }}>
          <div style={{ fontWeight: 600, color: testResult.valid ? 'var(--color-success)' : 'var(--color-danger)' }}>
            {testResult.valid ? '✅ Connection Successful' : '❌ Connection Failed'}
          </div>
          {testResult.error && (
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
              {testResult.error}
            </div>
          )}
        </div>
      )}

      {/* Message */}
      {message && (
        <div className={`card ${message.type === 'success' ? '' : ''}`} style={{
          borderLeft: `3px solid ${
            message.type === 'success' ? 'var(--color-success)' :
            message.type === 'error' ? 'var(--color-danger)' : 'var(--color-info)'
          }`,
          fontSize: 13,
          color: 'var(--color-text-secondary)',
        }}>
          {message.text}
        </div>
      )}

      {/* Info Card */}
      <div className="card" style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
        <strong>How credentials are stored:</strong>
        <ul style={{ marginTop: 8, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>Keys are encrypted with AES-256-GCM before writing to disk</li>
          <li>Encrypted file: <code>~/.harness/credentials.enc</code></li>
          <li>Encryption key is derived from your machine's hostname + username</li>
          <li>For production deployment, use the <code>DEEPSEEK_API_KEY</code> environment variable</li>
          <li>The key is never logged, never exposed in API responses, and never committed to git</li>
        </ul>
      </div>
    </div>
  );
}