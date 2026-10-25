import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { localGateway, openHostTls } from './host';
import { api } from '../cloud';
import { connectPinnedTls } from './tls';

vi.mock('../cloud', () => ({ api: vi.fn(), cloudEndpoint: 'https://cloud.test' }));
vi.mock('./tls', () => ({ connectPinnedTls: vi.fn() }));
const opened: string[] = [];
class Socket {
  static OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  onopen?: () => void;
  constructor(url: string) {
    opened.push(url);
    queueMicrotask(() => this.onopen?.());
  }
  close() {}
  send() {}
}
beforeEach(() => {
  opened.length = 0;
  vi.stubGlobal('WebSocket', Socket);
  vi.mocked(api).mockReset().mockResolvedValue({ tunnelId: 'tunnel', clientTicket: 'ticket' });
  vi.mocked(connectPinnedTls)
    .mockReset()
    .mockResolvedValue({ close() {} } as Awaited<ReturnType<typeof connectPinnedTls>>);
});
afterEach(() => vi.unstubAllGlobals());
it('only probes fixed private IPv4 TLS endpoints', () => {
  expect(localGateway('https://192.168.1.20:49321')).toBe('ws://192.168.1.20:49322/api/v1/lan');
  expect(localGateway('https://172.31.2.3:444')).toBe('ws://172.31.2.3:445/api/v1/lan');
  for (const endpoint of [
    'http://10.1.2.3:443',
    'https://example.com:443',
    'https://8.8.8.8:999',
    'https://127.0.0.1:999',
    'https://10.1.2.3:65535',
    'https://user@10.1.2.3:999',
    'https://10.1.2.3:999/path',
    'https://10.1.2.3:999/?q=1',
  ])
    expect(localGateway(endpoint)).toBeUndefined();
});
it('uses the pinned LAN connection without opening a cloud tunnel', async () => {
  await openHostTls('host', 'pin', ['https://10.1.2.3:49321']);
  expect(opened).toEqual(['ws://10.1.2.3:49322/api/v1/lan']);
  expect(api).not.toHaveBeenCalled();
  expect(connectPinnedTls).toHaveBeenCalledWith(expect.anything(), 'pin');
});
it('falls back to the cloud automatically when the local route is unavailable', async () => {
  vi.mocked(connectPinnedTls).mockRejectedValueOnce(new Error('LAN closed'));
  await openHostTls('host', 'pin', ['https://10.1.2.3:49321']);
  expect(opened).toEqual([
    'ws://10.1.2.3:49322/api/v1/lan',
    'wss://cloud.test/api/v1/relay/tunnels/tunnel/client',
  ]);
  expect(api).toHaveBeenCalledOnce();
});
it('never falls back after a local computer certificate mismatch', async () => {
  vi.mocked(connectPinnedTls).mockRejectedValueOnce(
    new Error('Host certificate does not match invitation'),
  );
  await expect(openHostTls('host', 'pin', ['https://10.1.2.3:49321'])).rejects.toThrow(
    'certificate',
  );
  expect(api).not.toHaveBeenCalled();
});
