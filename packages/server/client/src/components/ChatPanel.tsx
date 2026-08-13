import React, { useEffect, useRef, useState } from 'react';
import type { RuntimeExperience, RuntimeSession } from '../hooks/useRuntimeInfo.js';
import { useSSE } from '../hooks/useSSE.js';
import { ToolCallCard } from './ToolCallCard.js';
import { GuardrailDialog } from './GuardrailDialog.js';
import { FeedbackTimeline } from './FeedbackTimeline.js';
import { appendPublicSession, type PublicSessionHistory } from '../history/public-history.js';

interface BrowserSecurityInfo {
  isSecureContext: boolean;
  hostname: string;
}

interface ChatPanelProps {
  runtimeInfo: RuntimeSession;
  acquireSession(signal?: AbortSignal): Promise<RuntimeSession>;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const EXPERIENCE_CATALOG: RuntimeExperience[] = ['demo', 'byok', 'server'];

export const isByokBrowserAllowed = (info: BrowserSecurityInfo): boolean => (
  info.isSecureContext || LOOPBACK_HOSTS.has(info.hostname.toLowerCase())
);

export async function saveSessionFile(sessionId: string, fileName: string): Promise<{ path: string }> {
  const response = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}/save`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'FILE_SAVE_FAILED');
  return body as { path: string };
}

const experienceLabel = (experience: RuntimeExperience): string => {
  if (experience === 'demo') return '安全演示';
  if (experience === 'byok') return '使用自己的 API Key';
  return '本地服务器凭据';
};

const defaultExperience = (runtime: RuntimeSession): RuntimeExperience => (
  runtime.mode === 'local' && runtime.capabilities.allowedExperiences.includes('server')
    ? 'server'
    : 'demo'
);

const EXAMPLE_TASK = '创建一个安全的 TypeScript 示例文件，并展示护栏与反馈修正流程';

const PUBLIC_TOOL_NAMES = new Set(['read_file', 'write_file', 'list_files']);
const PUBLIC_RISK_LEVELS = new Set(['safe', 'moderate', 'dangerous']);
const PUBLIC_TOOL_STAGES = new Set(['initial_write', 'dangerous_action_blocked', 'corrected_write']);
const PUBLIC_TOOL_STATUSES = new Set(['pending', 'done', 'failed']);
const PUBLIC_FEEDBACK_SUMMARIES = new Set(['1 test failure(s) detected.']);

const allowlistedText = (
  value: unknown,
  allowed: ReadonlySet<string>,
  fallback = '',
): string => typeof value === 'string' && allowed.has(value) ? value : fallback;

const publicToolCallSummary = (data: any) => ({
  name: allowlistedText(data?.name, PUBLIC_TOOL_NAMES, 'file_tool'),
  riskLevel: allowlistedText(data?.riskLevel, PUBLIC_RISK_LEVELS, 'safe'),
  stage: allowlistedText(data?.stage, PUBLIC_TOOL_STAGES),
  status: allowlistedText(data?.status, PUBLIC_TOOL_STATUSES),
  result: {
    success: data?.result?.success === true,
    ...(data?.result?.success === true ? {} : { error: 'TOOL_CALL_FAILED' }),
  },
});

const publicFeedbackSummary = (value: unknown): string | null => {
  const summary = allowlistedText(value, PUBLIC_FEEDBACK_SUMMARIES);
  return summary || null;
};

export function ChatPanel({ runtimeInfo, acquireSession }: ChatPanelProps) {
  const [task, setTask] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [experience, setExperience] = useState<RuntimeExperience>(() => defaultExperience(runtimeInfo));
  const [apiKey, setApiKey] = useState('');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [saveFileName, setSaveFileName] = useState('');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const activeRun = useRef(false);
  const mounted = useRef(true);
  const runGeneration = useRef(0);
  const runAbortController = useRef<AbortController | null>(null);
  const recordedSessionId = useRef<string | null>(null);
  const { events, isConnected, error: streamError, connect, close } = useSSE();
  const byokAllowed = runtimeInfo.capabilities.allowHttpByok || isByokBrowserAllowed({
    isSecureContext: window.isSecureContext === true,
    hostname: window.location.hostname,
  });

  const lastEvent = events.at(-1);
  const isComplete = lastEvent?.type === 'complete';
  const feedbackRuns = events.filter((event) => event.type === 'feedback').map((event) => event.data);

  useEffect(() => {
    const allowed = runtimeInfo.capabilities.allowedExperiences;
    if (!allowed.includes(experience)) {
      setExperience(defaultExperience(runtimeInfo));
      setApiKey('');
      close();
    }
  }, [close, experience, runtimeInfo]);

  useEffect(() => {
    if (lastEvent?.type === 'complete' || lastEvent?.type === 'error') {
      activeRun.current = false;
      setRunning(false);
      setApiKey('');
    }
  }, [lastEvent]);

  useEffect(() => {
    if (runtimeInfo.mode !== 'public' || !sessionId || !lastEvent) return;
    if (lastEvent.type !== 'complete' && lastEvent.type !== 'error') return;
    if (recordedSessionId.current === sessionId) return;

    const historyEntry: PublicSessionHistory = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      task,
      status: lastEvent.type === 'complete' ? 'completed' : 'failed',
      conclusion: lastEvent.type === 'complete' ? '任务完成' : '运行失败',
      feedbackRuns: feedbackRuns.map((feedback: any, index: number) => ({
        iteration: index,
        testResult: feedback.status === 'pass' ? 'pass' : 'fail',
        failureCount: Array.isArray(feedback.failures) ? feedback.failures.length : 0,
        fixApplied: false,
        timeSpent: 0,
      })),
    };
    appendPublicSession(historyEntry);
    recordedSessionId.current = sessionId;
  }, [feedbackRuns, lastEvent, runtimeInfo.mode, sessionId, task]);

  useEffect(() => {
    if (!streamError) return;
    activeRun.current = false;
    setRunning(false);
    setApiKey('');
  }, [streamError]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runGeneration.current += 1;
      runAbortController.current?.abort();
      runAbortController.current = null;
      activeRun.current = false;
      close();
    };
  }, [close]);

  const changeExperience = (next: RuntimeExperience) => {
    if (running || next === experience) return;
    runGeneration.current += 1;
    runAbortController.current?.abort();
    runAbortController.current = null;
    setApiKey('');
    setRunError(null);
    setSessionId(null);
    close();
    setExperience(next);
  };

  const stopStarting = () => {
    activeRun.current = false;
    setRunning(false);
    setApiKey('');
    close();
  };

  const handleSave = async () => {
    if (!sessionId || !saveFileName.trim() || saving || runtimeInfo.mode !== 'local') return;
    setSaving(true); setSaveStatus(null);
    try {
      const result = await saveSessionFile(sessionId, saveFileName.trim());
      setSaveStatus(`Saved to ${result.path}`);
    } catch (error: unknown) {
      setSaveStatus(`Save failed: ${error instanceof Error ? error.message : 'FILE_SAVE_FAILED'}`);
    } finally { setSaving(false); }
  };

  const handleSubmit = async (requestedTask?: string) => {
    const finalTask = (requestedTask ?? task).trim();
    if (!finalTask || activeRun.current) return;
    if (experience === 'byok' && (!byokAllowed || !apiKey)) return;

    activeRun.current = true;
    const generation = runGeneration.current + 1;
    runGeneration.current = generation;
    const abortController = new AbortController();
    runAbortController.current = abortController;
    setRunning(true);
    setRunError(null);
    setTask(finalTask);

    try {
      const session = await acquireSession(abortController.signal);
      if (!mounted.current || runGeneration.current !== generation) return;
      if (!session.capabilities.allowedExperiences.includes(experience)) {
        throw new Error('EXPERIENCE_NOT_ALLOWED');
      }
      setSessionId(session.sessionId);
      await connect(session.sessionId, 15_000);
      if (!mounted.current || runGeneration.current !== generation) return;

      const request: {
        sessionId: string;
        task: string;
        mode: RuntimeExperience;
        apiKey?: string;
      } = {
        sessionId: session.sessionId,
        task: finalTask,
        mode: experience,
      };
      if (experience === 'byok') request.apiKey = apiKey;

      const response = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: abortController.signal,
      });
      if (!mounted.current || runGeneration.current !== generation) return;
      setApiKey('');
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || 'RUN_START_FAILED');
      }
    } catch (error: unknown) {
      if (!mounted.current || runGeneration.current !== generation) return;
      const message = error instanceof Error ? error.message : '';
      if (message === 'EXPERIENCE_NOT_ALLOWED') {
        setRunError('当前体验方式不被允许，请切换其他模式。');
      } else if (message === 'SSE_CONNECTION_TIMEOUT') {
        setRunError('实时连接超时，请检查网络后重试。');
      } else if (message === 'SSE_CONNECTION_FAILED') {
        setRunError('无法建立实时连接，请刷新页面后重试。');
      } else if (message === 'SESSION_ISSUE_FAILED') {
        setRunError('无法创建会话，请刷新页面后重试。');
      } else if (message === 'SESSION_NOT_FOUND') {
        setRunError('会话已过期，请刷新页面后重试。');
      } else if (message === 'RUN_RATE_LIMIT' || message === 'SESSION_RATE_LIMIT') {
        setRunError('请求过于频繁，请稍后重试。');
      } else if (message === 'CONCURRENT_RUN_LIMIT') {
        setRunError('已有运行中的任务，请等待完成后再试。');
      } else if (message === 'BYOK_REQUIRES_HTTPS') {
        setRunError('BYOK 模式需要 HTTPS 连接。');
      } else {
        setRunError('无法启动运行，请重试。');
      }
      stopStarting();
    } finally {
      if (runAbortController.current === abortController) {
        runAbortController.current = null;
      }
    }
  };

  return (
    <main className="chat-panel">
      <section className={`runtime-banner runtime-banner-${runtimeInfo.mode}`} aria-live="polite">
        <div>
          <strong>{runtimeInfo.mode === 'public' ? '公开安全模式' : '本地可信模式'}</strong>
          <span>
            {runtimeInfo.mode === 'public'
              ? ' 仅提供隔离文件工具；不会执行 Shell、Git 或进程测试。'
              : ' 可使用服务器凭据和完整的可信本地工具。'}
          </span>
        </div>
        <div className="capability-list" aria-label="服务器授予的能力">
          <span>进程工具：{runtimeInfo.capabilities.allowProcessTools ? '启用' : '禁用'}</span>
          <span>服务器凭据：{runtimeInfo.capabilities.allowServerCredentials ? '启用' : '禁用'}</span>
          <span>会话到期：{new Date(runtimeInfo.expiresAt).toLocaleTimeString()}</span>
        </div>
      </section>

      <fieldset className="experience-selector" disabled={running}>
        <legend>体验方式</legend>
        {EXPERIENCE_CATALOG
          .map((option) => {
          const disabled = !runtimeInfo.capabilities.allowedExperiences.includes(option)
            || (option === 'byok' && (!runtimeInfo.capabilities.allowByok || !byokAllowed));
          return (
            <label key={option} className={`experience-option ${disabled ? 'disabled' : ''}`}>
              <input
                type="radio"
                name="experience"
                value={option}
                checked={experience === option}
                disabled={disabled}
                onChange={() => changeExperience(option)}
              />
              <span>{experienceLabel(option)}</span>
              {runtimeInfo.mode === 'public' && option === 'byok' && (
                <span className="experience-option-description">
                  公网演示不接受 API Key。完整项目可在 localhost 或 127.0.0.1 上运行。
                </span>
              )}
              {runtimeInfo.mode === 'public' && option === 'server' && (
                <span className="experience-option-description">
                  服务器凭据仅在本地可信模式可用；由本地用户配置、更新和清除。
                </span>
              )}
            </label>
          );
        })}
      </fieldset>

      {!byokAllowed && !runtimeInfo.capabilities.allowHttpByok && runtimeInfo.capabilities.allowByok && (
        <p className="security-notice" role="note">
          使用自己的 API Key 需要 HTTPS；仅 localhost、127.0.0.1 和 ::1 可在 HTTP 下开发调试。
        </p>
      )}

      {experience === 'byok' && runtimeInfo.capabilities.allowByok && byokAllowed && (
        <div className="byok-field">
          <label htmlFor="deepseek-api-key">DeepSeek API Key</label>
          <input
            id="deepseek-api-key"
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            disabled={running}
            aria-describedby="byok-help"
          />
          <p id="byok-help">
            Key 仅保留在当前组件内存中，通过本次 HTTPS 请求发送；不会写入浏览器或服务器配置。
          </p>
        </div>
      )}

      <section className="task-composer" aria-labelledby="task-heading">
        <h2 id="task-heading">开始一个编码任务</h2>
        <label htmlFor="task-input">任务</label>
        <div className="chat-input-row">
          <input
            id="task-input"
            className="input"
            value={task}
            onChange={(event) => setTask(event.target.value)}
            placeholder="描述你希望 Agent 完成的编码任务"
            disabled={running}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleSubmit();
            }}
          />
          <button
            className="btn btn-primary"
            onClick={() => void handleSubmit()}
            disabled={running || !task.trim() || (experience === 'byok' && !apiKey)}
          >
            {running ? '运行中…' : '开始运行'}
          </button>
        </div>
        {!events.length && !running && (
          <button className="btn btn-secondary example-run" onClick={() => void handleSubmit(EXAMPLE_TASK)}>
            运行推荐示例
          </button>
        )}
      </section>

      {/* 初始状态：欢迎引导 + 示例任务 */}
      {!events.length && !running && !runError && !streamError && (
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
              <div className="feature-item" style={{ marginBottom: 0 }}>
                <div className="feature-icon">🗂️</div>
                <div>
                  <div className="feature-desc">
                    Agent 创建的文件保存在服务器隔离工作区中：
                  </div>
                  <code className="file-location">
                    {runtimeInfo.workspaceRoot ?? '&lt;工作区根目录&gt;'}\{'{会话ID}'}\
                  </code>
                  <div className="feature-desc" style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>
                    每个会话使用独立的隔离目录，任务完成后会自动清理。
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isConnected && !isComplete && (
        <div className="connection-status">
          <span className="status-dot status-dot-pass" />
          实时连接已建立，Agent 正在工作
        </div>
      )}
      {(runError || streamError) && <div className="event-error" role="alert">{runError ?? streamError}</div>}

      <section className="event-stream" aria-label="运行事件">
        {events.map((event, index) => {
          if (event.type === 'tool_call') {
            const displayData = runtimeInfo.mode === 'public'
              ? publicToolCallSummary(event.data)
              : event.data;
            return <ToolCallCard key={index} data={displayData} />;
          }
          if (event.type === 'guardrail' && runtimeInfo.mode === 'public') {
            return <div key={index} className="event-message">操作已被安全策略拦截。</div>;
          }
          if (event.type === 'guardrail' && sessionId) {
            return <GuardrailDialog key={index} data={event.data} sessionId={sessionId} />;
          }
          if (event.type === 'feedback') {
            const feedback = event.data;
            if (runtimeInfo.mode === 'public') {
              const safeSummary = publicFeedbackSummary(feedback.actionableFix?.summary);
              return (
                <div key={index} className="event-message">
                  <strong>反馈：</strong>{feedback.status === 'pass' ? '验证通过' : '验证失败'}
                  {safeSummary && <div>{safeSummary}</div>}
                </div>
              );
            }
            return (
              <div key={index} className="event-message">
                <strong>反馈：</strong>
                {feedback.status === 'pass'
                  ? '✅ 全部测试通过'
                  : `❌ ${feedback.failures?.length || 0} 个测试失败`}
                {feedback.failures?.map((failure: any, failureIndex: number) => (
                  <div key={failureIndex} className="feedback-failure">
                    {failure.file}:{failure.line} — {failure.message} (
                    {failure.type === 'syntax'
                      ? '语法'
                      : failure.type === 'assertion'
                        ? '断言'
                        : failure.type === 'timeout'
                          ? '超时'
                          : '运行时'}
                    )
                  </div>
                ))}
                {feedback.actionableFix?.summary && <div>{feedback.actionableFix.summary}</div>}
              </div>
            );
          }
          if (event.type === 'loop_step') {
            return (
              <div key={index} className="event-message">
                <strong>步骤：</strong>
                {runtimeInfo.mode === 'public'
                  ? allowlistedText(event.data?.stage, PUBLIC_TOOL_STAGES, '安全执行中')
                  : event.data?.content ?? event.data?.stage ?? event.data?.phase}
              </div>
            );
          }
          if (event.type === 'error') {
            return <div key={index} className="event-error">运行失败，请稍后重试。</div>;
          }
          if (event.type === 'complete') {
            return <div key={index} className="event-complete">✓ 任务完成</div>;
          }
          const content = event.data?.content ?? event.type;
          return (
            <div key={index} className="event-message">
              {runtimeInfo.mode === 'public' ? '收到安全运行事件。' : content}
            </div>
          );
        })}
      </section>

      {isComplete && (
        <div className="card completion-note">
          {runtimeInfo.mode === 'local' && <div className="save-file-panel">
            <p>Long-term save: enter a relative workspace file path. It will be copied to the project <code>.harness/outputs/</code>.</p>
            <label htmlFor="save-file-name">File path</label>
            <input id="save-file-name" value={saveFileName} onChange={(event) => setSaveFileName(event.target.value)} placeholder="src/example.ts" disabled={saving} />
            <button className="btn btn-secondary" onClick={() => void handleSave()} disabled={!saveFileName.trim() || saving}>{saving ? 'Saving…' : 'Save to project'}</button>
            {saveStatus && <div role="status" className="save-status">{saveStatus}</div>}
          </div>}
          文件保存在隔离工作区：<code>{runtimeInfo.workspaceRoot ?? '&lt;工作区&gt;'}\{sessionId}\</code>
        </div>
      )}

      {isComplete && feedbackRuns.length > 0 && (
        <div className="card feedback-summary">
          <FeedbackTimeline runs={feedbackRuns.map((feedback: any, index: number) => ({
            iteration: index,
            testResult: feedback.status === 'pass' ? 'pass' as const : 'fail' as const,
            failureCount: feedback.failures?.length ?? 0,
            fixApplied: false,
            timeSpent: 0,
          }))} />
        </div>
      )}
    </main>
  );
}
