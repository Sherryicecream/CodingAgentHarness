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
    return <div className="feedback-empty">No feedback iterations yet.</div>;
  }

  return (
    <div className="feedback-timeline">
      <h4 className="feedback-title">Feedback Iterations</h4>
      <div className="timeline">
        <div className="timeline-line" />
        {runs.map((run, i) => (
          <div key={i} className="timeline-item">
            <div className={`timeline-node timeline-node-${run.testResult}`} />
            <div className="timeline-content">
              <div className="timeline-header">
                <span className="timeline-label">Iteration #{run.iteration}</span>
                <span className={`timeline-badge timeline-badge-${run.testResult}`}>
                  {run.testResult === 'pass' ? 'PASS' : 'FAIL'}
                </span>
                {run.fixApplied && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Fix applied</span>}
              </div>
              <div className="timeline-meta">
                <span>Failures: {run.failureCount}</span>
                <span>Time: {(run.timeSpent / 1000).toFixed(1)}s</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}