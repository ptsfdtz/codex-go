import { beforeEach, expect, it, vi } from 'vitest';
import { Bridge } from './bridge';
import { HostSocket } from './host';
import { testLocks } from '../../tests/locks';

vi.mock('./host', () => ({ HostSocket: { connect: vi.fn() } }));
const storage = new Map<string, string>();
const key = 'agentdeck.web.receipts.account:device.host';
let sent: { id: string; action: string }[];
let receiptStatus = 'pending';
let responseCode = '';
let deferTurn = false;
let finishTurn: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal('navigator', { locks: testLocks() });
  storage.clear();
  sent = [];
  receiptStatus = 'pending';
  responseCode = '';
  deferTurn = false;
  finishTurn = undefined;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.mocked(HostSocket.connect).mockImplementation(async () => {
    let receive: (text: string) => void;
    return {
      receive: (handler: typeof receive) => {
        receive = handler;
      },
      close: () => {},
      send: async (text: string) => {
        const request = JSON.parse(text);
        sent.push(request);
        const payload =
          request.action === 'system.hello'
            ? { hostId: 'host' }
            : request.action === 'requests.status'
              ? {
                  status: receiptStatus,
                  response:
                    receiptStatus === 'done'
                      ? { type: 'response', id: request.payload.requestId }
                      : null,
                }
              : {};
        const reply = () =>
          receive(
            JSON.stringify(
              responseCode && request.action === 'turn.start'
                ? { type: 'error', id: request.id, code: responseCode }
                : { type: 'response', id: request.id, payload },
            ),
          );
        if (deferTurn && request.action === 'turn.start') finishTurn = reply;
        else queueMicrotask(reply);
      },
    } as unknown as HostSocket;
  });
});
async function connect() {
  const bridge = new Bridge('account:device');
  await bridge.connect({ hostId: 'host', fingerprint: 'pin', credential: 'grant' });
  return bridge;
}
it('keeps an in-flight send reserved without reporting its result as unknown', async () => {
  const bridge = await connect();
  deferTurn = true;
  const sending = bridge.request('turn.start');
  await vi.waitFor(() => expect(finishTurn).toBeTypeOf('function'));
  expect(JSON.parse(storage.get(key)!)).toHaveLength(1);
  expect(bridge.awaitingReceipt).toBe(false);
  await bridge.request('snapshot.get');
  expect(bridge.awaitingReceipt).toBe(false);
  finishTurn!();
  await sending;
  expect(bridge.awaitingReceipt).toBe(false);
  expect(storage.has(key)).toBe(false);
  bridge.close();
});
it('changes an in-flight send to unknown when the connection closes', async () => {
  const bridge = await connect();
  deferTurn = true;
  const sending = bridge.request('turn.start');
  const rejected = expect(sending).rejects.toThrow('closed');
  await vi.waitFor(() => expect(finishTurn).toBeTypeOf('function'));
  expect(bridge.awaitingReceipt).toBe(false);
  bridge.close();
  await rejected;
  expect(bridge.awaitingReceipt).toBe(true);
  expect(JSON.parse(storage.get(key)!)).toHaveLength(1);
});
it('retains an unknown outcome and blocks another mutation', async () => {
  const bridge = await connect();
  responseCode = 'OUTCOME_UNKNOWN';
  await expect(bridge.request('turn.start')).rejects.toThrow('OUTCOME_UNKNOWN');
  expect(JSON.parse(storage.get(key)!)).toHaveLength(1);
  await expect(bridge.request('turn.start')).rejects.toThrow('尚未确定');
  expect(sent.filter((value) => value.action === 'turn.start')).toHaveLength(1);
  bridge.close();
});
it('retains pending receipts across reconnect and clears a confirmed result', async () => {
  storage.set(key, JSON.stringify(['previous']));
  const first = await connect();
  expect(JSON.parse(storage.get(key)!)).toEqual(['previous']);
  first.close();
  receiptStatus = 'done';
  const second = await connect();
  expect(storage.has(key)).toBe(false);
  second.close();
});
it('does not send a mutation when its receipt cannot be persisted', async () => {
  const bridge = await connect();
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota');
    },
  });
  await expect(bridge.request('turn.start')).rejects.toThrow('无法保存');
  expect(sent.filter((value) => value.action === 'turn.start')).toHaveLength(0);
  bridge.close();
});
it('does not import receipts belonging to another account or device', async () => {
  storage.set('agentdeck.web.receipts.other:device.host', '["other"]');
  const bridge = await connect();
  expect(sent.some((value) => value.action === 'requests.status')).toBe(false);
  bridge.close();
});
it('settles a confirmed response even when receipt cleanup fails', async () => {
  const bridge = await connect();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: () => {
      throw new Error('storage unavailable');
    },
  });
  await expect(bridge.request('turn.start')).resolves.toEqual({});
  expect(JSON.parse(storage.get(key)!)).toHaveLength(1);
  bridge.close();
});
it('refuses to overwrite an unreadable receipt journal with a new mutation', async () => {
  const bridge = await connect();
  storage.set(key, '{}');
  await expect(bridge.request('turn.start')).rejects.toThrow('无法保存');
  expect(sent.filter((value) => value.action === 'turn.start')).toHaveLength(0);
  expect(storage.get(key)).toBe('{}');
  bridge.close();
});

it.each(['pending', 'unknown', 'notFound'])(
  'retains %s receipts instead of claiming success',
  async (status) => {
    storage.set(key, '["previous"]');
    receiptStatus = status;
    const bridge = await connect();
    expect(storage.get(key)).toBe('["previous"]');
    await expect(bridge.request('turn.interrupt')).rejects.toThrow('尚未确定');
    expect(sent.some((item) => item.action === 'turn.interrupt')).toBe(false);
    bridge.close();
  },
);
it('atomically reserves a receipt across two independent connections', async () => {
  const first = await connect(),
    second = await connect();
  responseCode = 'OUTCOME_UNKNOWN';
  const outcomes = await Promise.allSettled([
    first.request('turn.start'),
    second.request('turn.start'),
  ]);
  expect(outcomes.every((item) => item.status === 'rejected')).toBe(true);
  expect(sent.filter((item) => item.action === 'turn.start')).toHaveLength(1);
  expect(JSON.parse(storage.get(key)!)).toHaveLength(1);
  first.close();
  second.close();
});
