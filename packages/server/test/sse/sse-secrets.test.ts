import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import { createSSEManager } from '../../src/sse/sse-manager.js';

const SENTINEL = 'sk-test-sse-sentinel';

const createResponseCapture = () => {
  const chunks: string[] = [];
  let ended = false;
  const response = {
    writeHead: () => response,
    write: (chunk: string) => { chunks.push(chunk); return true; },
    end: () => { ended = true; return response; },
  } as unknown as Response;
  return {
    response,
    text: () => chunks.join(''),
    ended: () => ended,
  };
};

describe('SSE secret redaction', () => {
  it('redacts connected event bytes immediately before serialization', () => {
    const manager = createSSEManager();
    const capture = createResponseCapture();
    manager.setSecrets('connected', [SENTINEL]);
    manager.createConnection('connected', capture.response);

    manager.push('connected', {
      type: 'loop_step',
      data: { nested: [`provider echoed ${SENTINEL}`] },
      timestamp: new Date('2026-08-08T00:00:00.000Z'),
    });

    expect(capture.text()).toContain('[REDACTED]');
    expect(capture.text()).not.toContain(SENTINEL);
  });

  it('buffers only redacted serializable bytes and clears the secret context on close', () => {
    const manager = createSSEManager();
    const first = createResponseCapture();
    manager.setSecrets('buffered', [SENTINEL]);
    manager.push('buffered', {
      type: 'error',
      data: { error: new Error(`failed with ${SENTINEL}`) },
      timestamp: new Date('2026-08-08T00:00:00.000Z'),
    });
    manager.createConnection('buffered', first.response);

    expect(first.text()).toContain('[REDACTED]');
    expect(first.text()).not.toContain(SENTINEL);

    manager.close('buffered');
    const second = createResponseCapture();
    manager.createConnection('buffered', second.response);
    manager.push('buffered', {
      type: 'loop_step',
      data: SENTINEL,
      timestamp: new Date('2026-08-08T00:00:01.000Z'),
    });

    expect(first.ended()).toBe(true);
    expect(second.text()).toContain(SENTINEL);
  });

  it('keeps redaction active across a client disconnect until terminal cleanup', () => {
    const manager = createSSEManager();
    const first = createResponseCapture();
    manager.setSecrets('reconnect', [SENTINEL]);
    manager.createConnection('reconnect', first.response);

    manager.disconnect('reconnect');
    manager.push('reconnect', {
      type: 'loop_step',
      data: `late provider event ${SENTINEL}`,
      timestamp: new Date('2026-08-08T00:00:02.000Z'),
    });
    const second = createResponseCapture();
    manager.createConnection('reconnect', second.response);

    expect(first.ended()).toBe(true);
    expect(second.text()).toContain('[REDACTED]');
    expect(second.text()).not.toContain(SENTINEL);
  });
});
