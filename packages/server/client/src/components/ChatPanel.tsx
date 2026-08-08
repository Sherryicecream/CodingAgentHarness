import React, { useEffect, useRef, useState } from 'react';
import type { RuntimeExperience, RuntimeSession } from '../hooks/useRuntimeInfo.js';
import { useSSE } from '../hooks/useSSE.js';
import { ToolCallCard } from './ToolCallCard.js';
import { GuardrailDialog } from './GuardrailDialog.js';
import { FeedbackTimeline } from './FeedbackTimeline.js';

interface BrowserSecurityInfo {
  isSecureContext: boolean;
  hostname: string;
}

interface ChatPanelProps {
  runtimeInfo: RuntimeSession;
  acquireSession(): Promise<RuntimeSession>;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export const isByokBrowserAllowed = (info: BrowserSecurityInfo): boolean => (
  info.isSecureContext || LOOPBACK_HOSTS.has(info.hostname.toLowerCase())
);

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

const redactPublicText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.replace(/sk-[A-Za-z0-9_-]+/gi, '[REDACTED]');
};

const publicToolCallSummary = (data: any) => ({
  name: redactPublicText(data?.name),
  riskLevel: redactPublicText(data?.riskLevel),
  stage: redactPublicText(data?.stage),
  status: redactPublicText(data?.status),
  result: { success: data?.result?.success === true },
});

export function ChatPanel({ runtimeInfo, acquireSession }: ChatPanelProps) {
  const [task, setTask] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [experience, setExperience] = useState<RuntimeExperience>(() => defaultExperience(runtimeInfo));
  const [apiKey, setApiKey] = useState('');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const activeRun = useRef(false);
  const { events, isConnected, error: streamError, connect, close } = useSSE();
  const byokAllowed = isByokBrowserAllowed({
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
    if (!streamError) return;
    activeRun.current = false;
    setRunning(false);
    setApiKey('');
  }, [streamError]);

  useEffect(() => () => {
    activeRun.current = false;
    close();
  }, [close]);

  const changeExperience = (next: RuntimeExperience) => {
    if (running || next === experience) return;
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

  const handleSubmit = async (requestedTask?: string) => {
    const finalTask = (requestedTask ?? task).trim();
    if (!finalTask || activeRun.current) return;
    if (experience === 'byok' && (!byokAllowed || !apiKey)) return;

    activeRun.current = true;
    setRunning(true);
    setRunError(null);
    setTask(finalTask);

    try {
      const session = await acquireSession();
      if (!session.capabilities.allowedExperiences.includes(experience)) {
        throw new Error('EXPERIENCE_NOT_ALLOWED');
      }
      setSessionId(session.sessionId);
      await connect(session.sessionId, 5_000);

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
      });
      setApiKey('');
      if (!response.ok) throw new Error('RUN_START_FAILED');
    } catch {
      setRunError('无法启动运行，请重试。');
      stopStarting();
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
        {runtimeInfo.capabilities.allowedExperiences.map((option) => {
          const disabled = option === 'byok' && (!runtimeInfo.capabilities.allowByok || !byokAllowed);
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
            </label>
          );
        })}
      </fieldset>

      {!byokAllowed && runtimeInfo.capabilities.allowByok && (
        <p className="security-notice" role="note">
          使用自己的 API Key 需要 HTTPS；仅 localhost、127.0.0.1 和 ::1 可在 HTTP 下开发调试。
        </p>
      )}

      {experience === 'byok' && byokAllowed && (
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
          if (event.type === 'guardrail' && sessionId) {
            return <GuardrailDialog key={index} data={event.data} sessionId={sessionId} />;
          }
          if (event.type === 'feedback') {
            const feedback = event.data;
            return (
              <div key={index} className="event-message">
                <strong>反馈：</strong>{feedback.status === 'pass' ? '验证通过' : '验证失败'}
                {feedback.actionableFix?.summary && (
                  <div>
                    {runtimeInfo.mode === 'public'
                      ? redactPublicText(feedback.actionableFix.summary)
                      : feedback.actionableFix.summary}
                  </div>
                )}
              </div>
            );
          }
          if (event.type === 'loop_step') {
            const content = event.data?.content ?? event.data?.stage ?? event.data?.phase;
            return (
              <div key={index} className="event-message">
                <strong>步骤：</strong>
                {runtimeInfo.mode === 'public' ? redactPublicText(content) : content}
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
              {runtimeInfo.mode === 'public' ? redactPublicText(content) : content}
            </div>
          );
        })}
      </section>

      {isComplete && (
        <div className="card completion-note">
          本次文件保存在服务器分配的隔离临时工作区中；浏览器不能选择或查看服务器路径。
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
