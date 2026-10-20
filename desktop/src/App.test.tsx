import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App, newest, remaining } from './App';
import { emptyView, type View } from './host';

const mocked = vi.hoisted(() => ({
  action: vi.fn(),
  snapshot: vi.fn(),
  subscribe: vi.fn(),
  localRequests: vi.fn(),
  quit: vi.fn(),
  pickProject: vi.fn(),
  push: undefined as undefined | ((v: View) => void),
}));
vi.mock('./host', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./host')>()),
  host: mocked,
}));
function fixture(): View {
  return {
    ...structuredClone(emptyView),
    revision: 2,
    running: true,
    state: {
      codexReady: true,
      sandboxVerified: true,
      projects: [{ projectId: 'p', name: '真实项目的测试替身', canonicalPath: 'C:\\Work\\项目' }],
      devices: [],
      approvals: [],
      addresses: ['127.0.0.1', '192.168.1.9'],
      listenAddress: '192.168.1.9',
      endpoint: 'https://192.168.1.9:49321',
    },
  };
}
beforeEach(() => {
  mocked.action.mockReset().mockResolvedValue({});
  mocked.snapshot.mockResolvedValue(fixture());
  mocked.subscribe.mockImplementation(async (fn: (v: View) => void) => {
    mocked.push = fn;
    return () => {};
  });
  mocked.localRequests.mockResolvedValue(() => {});
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(cleanup);

describe('desktop human interactions', () => {
  it('shows real state without starting sync or pairing automatically', async () => {
    render(<App />);
    await screen.findByText('1 个工作区');
    expect(mocked.action).not.toHaveBeenCalled();
    expect(screen.getByText('Codex 已就绪')).toBeTruthy();
    expect(screen.getByRole('button', { name: '收起到托盘' })).toBeTruthy();
  });
  it('coalesces fast duplicate sync clicks and waits for backend result', async () => {
    let resolve: (v: unknown) => void = () => {};
    mocked.action.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    render(<App />);
    const button = await screen.findByRole('button', { name: '同步工作区' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocked.action).toHaveBeenCalledTimes(1);
    expect(mocked.action).toHaveBeenCalledWith({ action: 'workspaces.sync' });
    resolve({});
    await screen.findByRole('button', { name: '同步工作区' });
  });
  it('requires a separate human confirmation for an approval and preserves all IDs', async () => {
    const v = fixture();
    v.state.approvals = [
      {
        approvalId: 'a',
        sessionId: 's',
        turnId: 't',
        sessionTitle: '测试审批',
        method: 'item/commandExecution/requestApproval',
        status: 'pending',
        context: { command: 'Write-Output TEST_ONLY', cwd: 'C:/Work/项目' },
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        allowedDecisions: ['approve', 'reject'],
      },
    ];
    mocked.snapshot.mockResolvedValue(v);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /1 个操作等待你确认/ }));
    fireEvent.click(screen.getByRole('button', { name: '检查并允许一次' }));
    expect(mocked.action).not.toHaveBeenCalled();
    expect(screen.getByText(/TEST_ONLY/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认允许一次' }));
    await waitFor(() =>
      expect(mocked.action).toHaveBeenCalledWith({
        action: 'approval.decide',
        approvalId: 'a',
        sessionId: 's',
        turnId: 't',
        decision: 'approve',
      }),
    );
  });
  it('never confirms an incoming pairing request without a click', async () => {
    const v = fixture();
    v.pairing = {
      requestId: 'pair-human',
      code: '123456',
      displayName: '测试设备',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
    mocked.snapshot.mockResolvedValue(v);
    render(<App />);
    await screen.findByText('123456');
    expect(mocked.action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '配对码一致，确认' }));
    await waitFor(() =>
      expect(mocked.action).toHaveBeenCalledWith({
        action: 'pair.confirm',
        requestId: 'pair-human',
        approve: true,
      }),
    );
  });
  it('does not offer stale approvals after authoritative state removes them', async () => {
    const v = fixture();
    v.state.approvals = [
      {
        approvalId: 'expired',
        sessionId: 's',
        turnId: 't',
        method: 'item/fileChange/requestApproval',
        status: 'pending',
        context: {},
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        allowedDecisions: ['approve'],
      },
    ];
    mocked.snapshot.mockResolvedValue(v);
    render(<App />);
    await screen.findByText('Codex 已就绪');
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    fireEvent.click(screen.getByRole('button', { name: /待审批/ }));
    expect(screen.getByText('没有需要处理的审批')).toBeTruthy();
    expect(mocked.action).not.toHaveBeenCalled();
  });
  it('keeps readable error feedback when the service rejects an action', async () => {
    mocked.action.mockRejectedValue('工作区路径已经失效，请在本机重新授权。');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '同步工作区' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('重新授权');
  });
  it('rejects older hydration and expires codes without fake progress', () => {
    const current = fixture(),
      older = { ...fixture(), revision: 1 };
    expect(newest(current, older)).toBe(current);
    expect(remaining(new Date(Date.now() - 1).toISOString(), Date.now())).toBe(0);
  });
});
