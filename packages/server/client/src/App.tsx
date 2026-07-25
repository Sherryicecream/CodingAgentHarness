import React, { useState } from 'react';
import { ChatPanel } from './components/ChatPanel.js';
import { SessionHistory } from './components/SessionHistory.js';

export function App() {
  const [view, setView] = useState<'chat' | 'history'>('chat');

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 20, fontFamily: 'system-ui' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1>Harness</h1>
        <nav>
          <button onClick={() => setView('chat')}>Chat</button>
          <button onClick={() => setView('history')}>History</button>
        </nav>
      </header>
      {view === 'chat' ? <ChatPanel /> : <SessionHistory />}
    </div>
  );
}