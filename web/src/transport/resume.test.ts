import { expect, it, vi } from 'vitest';
import { EventCheckpoint, missedEvents, RebaseRequired, changesDirectory } from './resume';
import type { Packet } from './bridge';

const event = (eventId: string): Packet => ({ type: 'event', eventId });
it('merges replay/live overlap in order and checkpoints only applied batches', () => {
  const checkpoint = new EventCheckpoint();
  checkpoint.reset('9007199254740991');
  const consume = vi.fn();
  checkpoint.apply(
    [event('9007199254740993'), event('9007199254740992'), event('9007199254740992')],
    consume,
  );
  expect(consume.mock.calls[0]![0].map((packet: Packet) => packet.eventId)).toEqual([
    '9007199254740992',
    '9007199254740993',
  ]);
  checkpoint.apply([event('9007199254740992')], consume);
  expect(consume.mock.calls[1]![0]).toEqual([]);
  expect(checkpoint.cursor).toBe('9007199254740993');
  expect(() =>
    checkpoint.apply([event('9007199254740994')], () => {
      throw new Error('apply failed');
    }),
  ).toThrow();
  expect(checkpoint.cursor).toBe('9007199254740993');
});
it('detects a live gap instead of silently skipping a reordered or lost event', () => {
  const checkpoint = new EventCheckpoint();
  checkpoint.reset('10');
  expect(() => checkpoint.live([event('12')], vi.fn())).toThrow(RebaseRequired);
  expect(checkpoint.cursor).toBe('10');
  checkpoint.live([event('12'), event('11')], vi.fn());
  expect(checkpoint.cursor).toBe('12');
});
it('pages only through missing events, without requesting content or mutations', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ cursor: '12', more: true, events: [event('11'), event('12')] })
    .mockResolvedValueOnce({ cursor: '14', more: false, events: [event('13'), event('14')] });
  expect(
    (await missedEvents(request, '10', '14', () => true)).map((packet) => packet.eventId),
  ).toEqual(['11', '12', '13', '14']);
  expect(request.mock.calls.map(([action]) => action)).toEqual(['events.replay', 'events.replay']);
  expect(request.mock.calls[1]![1].cursor).toBe('12');
});
it('falls back once for an expired cursor and bounds a long offline backlog', async () => {
  await expect(
    missedEvents(vi.fn().mockRejectedValue(new Error('REPLAY_GAP')), '10', '20', () => true),
  ).rejects.toBeInstanceOf(RebaseRequired);
  let cursor = 0;
  const request = vi.fn().mockImplementation(async () => {
    const events = Array.from({ length: 256 }, () => event(String(++cursor)));
    return { events, cursor: String(cursor), more: true };
  });
  await expect(missedEvents(request, '0', '3000', () => true)).rejects.toBeInstanceOf(
    RebaseRequired,
  );
  expect(request).toHaveBeenCalledTimes(9);
});
it('rejects invalid progress and cancels recovery after a host switch', async () => {
  await expect(
    missedEvents(
      vi.fn().mockResolvedValue({ cursor: '10', more: true, events: [] }),
      '10',
      '20',
      () => true,
    ),
  ).rejects.toThrow('did not advance');
  const request = vi.fn();
  await expect(missedEvents(request, '10', '20', () => false)).rejects.toThrow('cancelled');
  expect(request).not.toHaveBeenCalled();
});
it('does not refresh the directory for text fragments, usage, or failed reads', () => {
  for (const action of [
    'turn.progress',
    'upstream.progress',
    'session.tokenUsage',
    'request.failed',
  ])
    expect(changesDirectory({ action })).toBe(false);
  for (const action of [
    'turn.completed',
    'approval.created',
    'session.updated',
    'session.historyChanged',
  ])
    expect(changesDirectory({ action })).toBe(true);
});
