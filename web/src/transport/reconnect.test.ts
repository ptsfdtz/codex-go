import { afterEach, expect, it, vi } from 'vitest';
import { ReconnectLoop, connectionError } from './reconnect';
afterEach(() => vi.useRealTimers());
it('reports transient timeouts without treating them as authorization failures', async () => {
  vi.useFakeTimers();
  const error = new DOMException('signal timed out', 'TimeoutError');
  const open = vi.fn().mockRejectedValue(error);
  const states = vi.fn();
  const loop = new ReconnectLoop(open, states);
  loop.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(states).toHaveBeenLastCalledWith('retrying', error);
  expect(connectionError(error)).toContain('自动重试');
  loop.stop();
});
it('distinguishes an authenticated link from completed recovery', async () => {
  let finish!: () => void;
  const states = vi.fn();
  const loop = new ReconnectLoop(async ({ linked }) => {
    linked();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  }, states);
  loop.start();
  expect(states.mock.calls.map(([state]) => state)).toEqual(['connecting', 'syncing']);
  finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(states).toHaveBeenLastCalledWith('connected');
  loop.stop();
});
it('backs off, wakes immediately on network recovery, and cancels timers on stop', async () => {
  vi.useFakeTimers();
  const open = vi.fn().mockRejectedValue(new Error('Cloud tunnel unavailable'));
  const states = vi.fn();
  const loop = new ReconnectLoop(open, states);
  loop.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(open).toHaveBeenCalledTimes(1);
  loop.wake();
  await vi.advanceTimersByTimeAsync(0);
  expect(open).toHaveBeenCalledTimes(2);
  loop.stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(open).toHaveBeenCalledTimes(2);
});
it.each([
  'Host certificate does not match invitation',
  'Host identity mismatch',
  'Host rejected WebSocket authorization',
  'Cannot read browser device storage',
])('does not automatically retry %s', async (message) => {
  vi.useFakeTimers();
  const open = vi.fn().mockRejectedValue(new Error(message));
  const states = vi.fn();
  const loop = new ReconnectLoop(open, states);
  loop.start();
  await vi.advanceTimersByTimeAsync(60_000);
  loop.wake();
  expect(open).toHaveBeenCalledTimes(1);
  expect(states).toHaveBeenLastCalledWith('blocked', expect.any(Error));
  loop.stop();
});
it('disposes a connection opening during a host switch and ignores its late completion', async () => {
  let finish!: () => void;
  const dispose = vi.fn(),
    states = vi.fn();
  const loop = new ReconnectLoop(async ({ own }) => {
    own(dispose);
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  }, states);
  loop.start();
  loop.stop();
  finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(states.mock.calls.some(([state]) => state === 'connected')).toBe(false);
});
