import { beforeEach, expect, it, vi } from 'vitest';
import { Bridge } from './bridge';
import { HostSocket } from './host';

vi.mock('./host', () => ({ HostSocket: { connect: vi.fn() } }));
const storage = new Map<string, string>();
const key = 'agentdeck.web.receipts.account:device.host';
let receive: (text: string) => void;
let sent: { id: string; action: string }[];
let receiptStatus = 'pending';
let responseCode = '';
beforeEach(() => {
  storage.clear();
  sent = [];
  receiptStatus = 'pending';
  responseCode = '';
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.mocked(HostSocket.connect).mockResolvedValue({
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
                response: receiptStatus === 'complete' ? { type: 'response' } : null,
              }
            : {};
      queueMicrotask(() =>
        receive(
          JSON.stringify(
            responseCode && request.action === 'turn.start'
              ? { type: 'error', id: request.id, code: responseCode }
              : { type: 'response', id: request.id, payload },
          ),
        ),
      );
    },
  } as unknown as HostSocket);
});
async function connect() {
  const bridge = new Bridge('account:device');
  await bridge.connect({ hostId: 'host', fingerprint: 'pin', credential: 'grant' });
  return bridge;
}
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
  receiptStatus = 'complete';
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
