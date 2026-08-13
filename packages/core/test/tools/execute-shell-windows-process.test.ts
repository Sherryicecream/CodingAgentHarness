import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
  spawn: spawnMock,
}));

describe('Windows shell process-tree termination', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('uses the system taskkill executable without a shell', async () => {
    const child = new EventEmitter();
    spawnMock.mockReturnValueOnce(child);
    const { terminateWindowsProcessTree } = await import('../../src/tools/execute-shell.js');

    const termination = terminateWindowsProcessTree(321, { SystemRoot: 'C:\\Windows' });
    child.emit('close', 0);
    await termination;

    expect(spawnMock).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/PID', '321', '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' },
    );
  });

  it('rejects when taskkill reports a non-zero exit code', async () => {
    const child = new EventEmitter();
    spawnMock.mockReturnValueOnce(child);
    const { terminateWindowsProcessTree } = await import('../../src/tools/execute-shell.js');

    const termination = terminateWindowsProcessTree(654, { SystemRoot: 'C:\\Windows' });
    child.emit('close', 5);

    await expect(termination).rejects.toThrow('taskkill exited with code 5');
  });

  it('rejects an absent or relative SystemRoot', async () => {
    const { terminateWindowsProcessTree } = await import('../../src/tools/execute-shell.js');

    await expect(terminateWindowsProcessTree(1, {})).rejects.toThrow('SystemRoot');
    await expect(terminateWindowsProcessTree(1, { SystemRoot: 'relative' }))
      .rejects.toThrow('SystemRoot');
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
