import React, { useState } from 'react';
import { useSSE, generateSessionId } from '../hooks/useSSE.js';
import { ToolCallCard } from './ToolCallCard.js';
import { GuardrailDialog } from './GuardrailDialog.js';
import { FeedbackTimeline } from './FeedbackTimeline.js';

const EXAMPLE_TASKS = [
  { title: '斐波那契数列', desc: '写一个 fibonacci.ts 文件，实现斐波那契数列函数，并读出文件内容' },
  { title: '简易计算器', desc: '创建 calculator.ts，实现加减乘除四个函数，用 node 运行测试' },
  { title: '文件排序', desc: '写一个 sort.ts 文件，实现冒泡排序和快速排序函数，并运行测试' },
  { title: '自定义任务', desc: '输入你自己的编程任务...' },
];

export function ChatPanel() {
  const [task, setTask] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const { events, isConnected, error } = useSSE(sessionId);

  const handleSubmit = async (customTask?: string) => {
    const finalTask = customTask || task;
    if (!finalTask.trim()) return;
    setRunning(true);
    setTask(finalTask);

    const sid = generateSessionId();
    setSessionId(sid);

    await new Promise(r => setTimeout(r, 100));

    try {
      const res = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: finalTask, workingDir: '/tmp/harness-workspace', sessionId: sid }),
      });

      if (!res.ok) {
        setRunning(false);
      }
    } catch {
      setRunning(false);
    }
  };

  const lastEvent = events[events.length - 1];
  const isComplete = lastEvent?.type === 'complete';
  const hasStarted = events.length > 0;
  const feedbackRuns = events
    .filter(e => e.type === 'feedback')
    .map(e => e.data);

  // 任务完成或出错时，恢复输入框可用
  React.useEffect(() => {
    if (lastEvent?.type === 'complete' || lastEvent?.type === 'error') {
      setRunning(false);
    }
  }, [lastEvent]);

  return (
    <div className="chat-panel">
      {/* 输入区域 */}
      <div className="chat-input-row">
        <input
          className="input"
          value={task}
          onChange={e => setTask(e.target.value)}
          placeholder="输入编程任务，例如：写一个 fibonacci 函数"
          disabled={running}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
        />
        <button
          className="btn btn-primary"
          onClick={() => handleSubmit()}
          disabled={running || !task.trim()}
        >
          {running ? '运行中...' : '发送'}
        </button>
      </div>

      {/* 连接状态 */}
      {isConnected && !isComplete && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="status-dot status-dot-pass"></span>
          已连接 — 代理正在工作
        </div>
      )}

      {error && <div className="event-error">{error}</div>}

      {/* 初始状态：欢迎引导 + 示例任务 */}
      {!hasStarted && !running && (
        <div>
          {/* 欢迎区域 */}
          <div className="welcome-card">
            <div className="welcome-header">
              <div className="welcome-icon">H</div>
              <div>
                <div className="welcome-title">Harness — 编码智能体工作台</div>
                <div className="welcome-subtitle">
                  一个自带<strong>反馈闭环</strong>的 AI 编程助手。输入任务，Agent 自动完成编码、测试、修正。
                </div>
              </div>
            </div>

            {/* 工作原理 */}
            <div className="welcome-section">
              <div className="welcome-section-title">📋 工作原理</div>
              <div className="flow-steps">
                <div className="flow-step">
                  <div className="flow-step-number">1</div>
                  <div className="flow-step-content">
                    <div className="flow-step-label">输入任务</div>
                    <div className="flow-step-desc">用自然语言描述编程任务</div>
                  </div>
                  <div className="flow-step-arrow">→</div>
                </div>
                <div className="flow-step">
                  <div className="flow-step-number">2</div>
                  <div className="flow-step-content">
                    <div className="flow-step-label">AI 编码</div>
                    <div className="flow-step-desc">Agent 自动读写文件、执行命令</div>
                  </div>
                  <div className="flow-step-arrow">→</div>
                </div>
                <div className="flow-step">
                  <div className="flow-step-number">3</div>
                  <div className="flow-step-content">
                    <div className="flow-step-label">自动测试</div>
                    <div className="flow-step-desc">运行测试并分析失败原因</div>
                  </div>
                  <div className="flow-step-arrow">→</div>
                </div>
                <div className="flow-step">
                  <div className="flow-step-number">4</div>
                  <div className="flow-step-content">
                    <div className="flow-step-label">反馈修正</div>
                    <div className="flow-step-desc">测试失败则自动修复，循环直到通过</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 核心功能 */}
            <div className="welcome-section">
              <div className="welcome-section-title">🔧 核心功能</div>
              <div className="feature-grid">
                <div className="feature-item">
                  <div className="feature-icon">🤖</div>
                  <div>
                    <div className="feature-label">自动编码与测试</div>
                    <div className="feature-desc">输入任务，Agent 自动完成代码编写并运行测试验证</div>
                  </div>
                </div>
                <div className="feature-item">
                  <div className="feature-icon">🔄</div>
                  <div>
                    <div className="feature-label">智能反馈闭环</div>
                    <div className="feature-desc">测试失败时自动分析原因、分类错误、生成修复建议</div>
                  </div>
                </div>
                <div className="feature-item">
                  <div className="feature-icon">🛡️</div>
                  <div>
                    <div className="feature-label">安全护栏</div>
                    <div className="feature-desc">危险操作（如删除文件、强制推送）需人工确认后才执行</div>
                  </div>
                </div>
                <div className="feature-item">
                  <div className="feature-icon">📜</div>
                  <div>
                    <div className="feature-label">历史回顾</div>
                    <div className="feature-desc">所有会话完整记录，可随时查看决策过程和修正记录</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 文件位置 */}
            <div className="welcome-section">
              <div className="welcome-section-title">📁 文件位置</div>
              <div className="welcome-note">
                <p>Agent 生成的文件默认保存在工作目录：</p>
                <code className="welcome-code">/tmp/harness-workspace/</code>
                <p style={{ marginTop: 8, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  你可以在 Agent 运行过程中实时查看每一步的工具调用和文件操作。如需更改工作目录，请联系管理员修改配置。
                </p>
              </div>
            </div>
          </div>

          {/* 快速开始 */}
          <h3 className="section-title" style={{ marginTop: 24 }}>💡 快速开始</h3>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
            选择一个示例任务，或在上方输入框输入自定义任务
          </p>
          <div className="example-grid">
            {EXAMPLE_TASKS.map((ex, i) => (
              <div
                key={i}
                className="card example-card"
                onClick={() => {
                  if (ex.title !== '自定义任务') {
                    handleSubmit(ex.desc);
                  } else {
                    setTask('');
                  }
                }}
              >
                <div className="example-card-title">{ex.title}</div>
                <div className="example-card-desc">{ex.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 事件流 */}
      <div className="event-stream">
        {events.map((e, i) => {
          if (e.type === 'tool_call') {
            return <ToolCallCard key={i} data={e.data} />;
          }
          if (e.type === 'guardrail') {
            return <GuardrailDialog key={i} data={e.data} sessionId={sessionId!} />;
          }
          if (e.type === 'feedback') {
            const fb = e.data;
            return (
              <div key={i} className="event-message" style={{ borderLeft: `3px solid ${fb.status === 'pass' ? 'var(--color-success)' : 'var(--color-danger)'}` }}>
                <strong>反馈：</strong> {fb.status === 'pass' ? '✅ 全部测试通过' : `❌ ${fb.failures?.length || 0} 个测试失败`}
                {fb.failures?.map((f: any, j: number) => (
                  <div key={j} style={{ fontSize: 12, marginTop: 4, color: 'var(--color-text-secondary)' }}>
                    {f.file}:{f.line} — {f.message} ({f.type === 'syntax' ? '语法' : f.type === 'assertion' ? '断言' : f.type === 'timeout' ? '超时' : '运行时'})
                  </div>
                ))}
              </div>
            );
          }
          if (e.type === 'loop_step') {
            return (
              <div key={i} className="event-message">
                <strong>步骤 {e.data.iteration ?? ''}:</strong> {e.data.content || e.data.phase}
              </div>
            );
          }
          if (e.type === 'error') {
            return (
              <div key={i} className="event-error">
                <strong>错误：</strong> {e.data?.message || '未知错误'}
                <div style={{ fontSize: 12, marginTop: 4, color: 'var(--color-text-muted)' }}>
                  代理遇到错误。请检查 API Key 是否有效，或前往 Config 页面重新配置。
                </div>
              </div>
            );
          }
          if (e.type === 'complete') {
            return (
              <div key={i} className="event-complete">
                ✅ 任务完成
              </div>
            );
          }
          return (
            <div key={i} className="event-message">
              {e.data?.content || e.type}
            </div>
          );
        })}
      </div>

      {/* 完成后的提示 */}
      {isComplete && (
        <div className="card" style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
          <strong>📍 文件位置：</strong>
          <br />
          代理生成的文件保存在工作目录：<code>/tmp/harness-workspace/</code>
          <br />
          如需更改工作目录，请联系管理员修改配置。
        </div>
      )}

      {/* 反馈闭环时间线 */}
      {isComplete && feedbackRuns.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <FeedbackTimeline runs={feedbackRuns.map((fb: any, idx: number) => ({
            iteration: idx,
            testResult: fb.status === 'pass' ? 'pass' as const : 'fail' as const,
            failureCount: fb.failures?.length || 0,
            fixApplied: false,
            timeSpent: 0,
          }))} />
        </div>
      )}
    </div>
  );
}