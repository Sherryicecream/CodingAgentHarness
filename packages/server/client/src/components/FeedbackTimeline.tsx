import React from 'react';

interface FeedbackRun {
  iteration: number;
  testResult: 'pass' | 'fail';
  failureCount: number;
  fixApplied: boolean;
  timeSpent: number;
}

export function FeedbackTimeline({ runs }: { runs: FeedbackRun[] }) {
  if (!runs || runs.length === 0) {
    return <div className="feedback-empty">暂无反馈迭代记录。</div>;
  }

  return (
    <div className="feedback-timeline">
      <h4 className="feedback-title">反馈迭代</h4>
      <div className="timeline">
        <div className="timeline-line" />
        {runs.map((run, i) => (
          <div key={i} className="timeline-item">
            <div className={`timeline-node timeline-node-${run.testResult}`} />
            <div className="timeline-content">
              <div className="timeline-header">
                <span className="timeline-label">第 #{run.iteration} 轮</span>
                <span className={`timeline-badge timeline-badge-${run.testResult}`}>
                  {run.testResult === 'pass' ? '通过' : '失败'}
                </span>
                {run.fixApplied && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>已修正</span>}
              </div>
              <div className="timeline-meta">
                <span>失败数：{run.failureCount}</span>
                <span>耗时：{(run.timeSpent / 1000).toFixed(1)}秒</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}