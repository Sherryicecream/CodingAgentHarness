import React from 'react';

interface FeedbackRun {
  iteration: number;
  testResult: 'pass' | 'fail';
  failureCount: number;
  fixApplied: boolean;
  timeSpent: number;
}

const stepColors = {
  pass: '#4caf50',
  fail: '#f44336',
};

const stepLabels = {
  pass: 'PASS',
  fail: 'FAIL',
};

export function FeedbackTimeline({ runs }: { runs: FeedbackRun[] }) {
  if (!runs || runs.length === 0) {
    return <div style={{ color: '#999', fontSize: 14, padding: '16px 0' }}>No feedback iterations yet.</div>;
  }

  return (
    <div style={{ padding: '8px 0' }}>
      <h4 style={{ margin: '0 0 12px 0', fontSize: 14, color: '#333' }}>Feedback Iterations</h4>
      <div style={{ position: 'relative', paddingLeft: 24 }}>
        {/* Vertical line */}
        <div style={{
          position: 'absolute',
          left: 7,
          top: 8,
          bottom: 8,
          width: 2,
          background: '#e0e0e0',
        }} />
        {runs.map((run, i) => (
          <div key={i} style={{ position: 'relative', marginBottom: 16 }}>
            {/* Circle node */}
            <div style={{
              position: 'absolute',
              left: -20,
              top: 4,
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: stepColors[run.testResult],
              border: '2px solid white',
              boxShadow: '0 0 0 1px ' + stepColors[run.testResult],
            }} />
            {/* Content */}
            <div style={{
              background: '#fafafa',
              border: '1px solid #eee',
              borderRadius: 4,
              padding: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>Iteration #{run.iteration}</span>
                <span style={{
                  background: stepColors[run.testResult],
                  color: 'white',
                  padding: '1px 6px',
                  borderRadius: 3,
                  fontSize: 11,
                  fontWeight: 600,
                }}>
                  {stepLabels[run.testResult]}
                </span>
                {run.fixApplied && (
                  <span style={{ fontSize: 11, color: '#666' }}>Fix applied</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#888', display: 'flex', gap: 16 }}>
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