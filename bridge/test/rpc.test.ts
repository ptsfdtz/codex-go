import { afterEach, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { RpcClient, initializeRpc } from '../src/rpc.js';
const clients: RpcClient[] = [];
function client(timeout = 2000, max = 1024 * 1024): RpcClient {
  const rpc = new RpcClient(
    process.execPath,
    [resolve('bridge/test/rpc-fixture.mjs')],
    timeout,
    max,
  );
  clients.push(rpc);
  rpc.start();
  return rpc;
}
afterEach(() => {
  for (const rpc of clients) rpc.stop();
  clients.length = 0;
});
describe('JSONL client', () => {
  it('initializes, routes concurrent ids and preserves UTF-8 across chunks', async () => {
    const rpc = client();
    await initializeRpc(rpc);
    const results = await Promise.all([
      rpc.request('model/list', {}),
      rpc.request('model/list', {}),
    ]);
    expect(results).toEqual([
      { data: [{ id: '测试😀' }], initialized: true },
      { data: [{ id: '测试😀' }], initialized: true },
    ]);
  });
  it('handles server requests with original numeric id', async () => {
    const rpc = client();
    await initializeRpc(rpc);
    const event = once(rpc, 'request');
    await rpc.request('account/read', { refreshToken: false });
    const [message] = await event;
    expect(message.id).toBe(17);
    const echoed = once(rpc, 'notification');
    rpc.respond(message.id, { decision: 'decline' });
    expect((await echoed)[0].params).toEqual({ id: 17, result: { decision: 'decline' } });
  });
  it('rejects RPC errors and times out without inventing completion', async () => {
    const rpc = client(150);
    await initializeRpc(rpc);
    await expect(rpc.request('thread/read', { threadId: 't' })).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
    await expect(rpc.request('model/list', { limit: 999 })).rejects.toMatchObject({
      code: 'UPSTREAM_TIMEOUT',
    });
  });
  it('fails closed on invalid JSON', async () => {
    const rpc = client();
    await initializeRpc(rpc);
    await expect(rpc.request('model/list', { limit: 998 })).rejects.toMatchObject({
      code: 'UPSTREAM_PROTOCOL_ERROR',
    });
  });
  it('bounds unterminated stdout', async () => {
    const rpc = client(2000, 4096);
    await initializeRpc(rpc);
    await expect(rpc.request('model/list', { limit: 997 })).rejects.toMatchObject({
      code: 'UPSTREAM_PROTOCOL_ERROR',
    });
  });
  it('rejects pending calls when child exits', async () => {
    const rpc = client();
    await initializeRpc(rpc);
    const pending = rpc.request('model/list', { limit: 999 });
    rpc.stop();
    await expect(pending).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });
});
