import React, { useState } from 'react';
import { ChatPanel } from './components/ChatPanel.js';
import { SessionHistory } from './components/SessionHistory.js';
import { ConfigPage } from './components/ConfigPage.js';
import './styles.css';

export function App() {
  const [view, setView] = useState<'chat' | 'history' | 'config'>('chat');

  return (
    <div className="app">
      <header className="header">
        <div className="header-logo">
          <span className="header-logo-icon">H</span>
          Harness
        </div>
        <nav className="nav-tabs">
          <button
            className={`nav-tab ${view === 'chat' ? 'active' : ''}`}
            onClick={() => setView('chat')}
          >
            对话
          </button>
          <button
            className={`nav-tab ${view === 'history' ? 'active' : ''}`}
            onClick={() => setView('history')}
          >
            历史
          </button>
          <button
            className={`nav-tab ${view === 'config' ? 'active' : ''}`}
            onClick={() => setView('config')}
          >
            配置
          </button>
        </nav>
      </header>
      {view === 'chat' ? <ChatPanel /> : view === 'history' ? <SessionHistory /> : <ConfigPage />}
    </div>
  );
}