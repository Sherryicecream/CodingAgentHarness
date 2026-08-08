import React, { useState } from 'react';
import { ChatPanel } from './components/ChatPanel.js';
import { SessionHistory } from './components/SessionHistory.js';
import { ConfigPage } from './components/ConfigPage.js';
import { useRuntimeInfo } from './hooks/useRuntimeInfo.js';
import './styles.css';

export function App() {
  const [view, setView] = useState<'chat' | 'history' | 'config'>(() => (
    window.location.pathname === '/config' ? 'config' : 'chat'
  ));
  const { runtimeInfo, loading, error, acquireSession, retry } = useRuntimeInfo();

  if (loading) {
    return <div className="loading-text">正在加载安全运行环境…</div>;
  }

  if (!runtimeInfo) {
    return (
      <div className="runtime-load-error" role="alert">
        <p>{error ?? '无法加载运行环境。'}</p>
        <button className="btn btn-primary" onClick={retry}>重试</button>
      </div>
    );
  }

  const effectiveView = runtimeInfo.mode === 'public' && view === 'config' ? 'chat' : view;

  return (
    <div className="app">
      <header className="header">
        <div className="header-logo">
          <span className="header-logo-icon">H</span>
          Harness
        </div>
        <nav className="nav-tabs" aria-label="主导航">
          <button
            className={`nav-tab ${effectiveView === 'chat' ? 'active' : ''}`}
            onClick={() => setView('chat')}
          >
            对话
          </button>
          <button
            className={`nav-tab ${effectiveView === 'history' ? 'active' : ''}`}
            onClick={() => setView('history')}
          >
            历史
          </button>
          {runtimeInfo.mode === 'local' && (
            <button
              className={`nav-tab ${effectiveView === 'config' ? 'active' : ''}`}
              onClick={() => setView('config')}
            >
              配置
            </button>
          )}
        </nav>
      </header>
      {effectiveView === 'chat' ? (
        <ChatPanel runtimeInfo={runtimeInfo} acquireSession={acquireSession} />
      ) : effectiveView === 'history' ? <SessionHistory /> : <ConfigPage />}
    </div>
  );
}
