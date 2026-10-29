import { api, cloudEndpoint } from '../cloud';
import type { BinaryTransport, TlsChannel } from './tls';

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const MAX_MESSAGE = 4 * 1024 * 1024;
const join = (a: Uint8Array, b: Uint8Array) => {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
};

export class ByteReader {
  private buffer: Uint8Array = new Uint8Array();
  private error?: Error;
  private wake?: () => void;
  constructor(channel: TlsChannel) {
    channel.receive(
      (bytes) => {
        if (this.buffer.length + bytes.length > MAX_MESSAGE * 2) {
          channel.close();
          return;
        }
        this.buffer = join(this.buffer, bytes);
        this.wake?.();
      },
      (error) => {
        this.error = error;
        this.wake?.();
      },
    );
  }
  private async more() {
    if (this.error) throw this.error;
    await new Promise<void>((resolve) => {
      this.wake = resolve;
    });
    this.wake = undefined;
  }
  async exact(length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_MESSAGE)
      throw new Error('Host message too large');
    while (this.buffer.length < length) await this.more();
    const result = this.buffer.slice(0, length);
    this.buffer = this.buffer.slice(length);
    return result;
  }
  async line(): Promise<string> {
    for (;;) {
      const index = this.buffer.findIndex((byte, i) => byte === 13 && this.buffer[i + 1] === 10);
      if (index >= 0) {
        if (index > 16384) throw new Error('Host header too large');
        const result = decode(this.buffer.slice(0, index));
        this.buffer = this.buffer.slice(index + 2);
        return result;
      }
      if (this.buffer.length > 16384) throw new Error('Host header too large');
      await this.more();
    }
  }
}

async function responseHeaders(reader: ByteReader) {
  const status = await reader.line();
  const match = /^HTTP\/1\.1 (\d{3})(?: |$)/.exec(status);
  if (!match) throw new Error('Invalid host HTTP response');
  const headers = new Map<string, string>();
  let bytes = status.length;
  for (;;) {
    const line = await reader.line();
    bytes += line.length + 2;
    if (bytes > 16384) throw new Error('Host headers too large');
    if (!line) break;
    const colon = line.indexOf(':');
    if (colon < 1) throw new Error('Invalid host header');
    const name = line.slice(0, colon).toLowerCase();
    if (headers.has(name)) throw new Error('Duplicate host header');
    headers.set(name, line.slice(colon + 1).trim());
  }
  return { status: Number(match[1]), headers };
}

export async function openHostTls(
  hostId: string,
  fingerprint: string,
  endpoints: string[] = [],
): Promise<TlsChannel> {
  // LAN availability is a browser capability, never a prerequisite for use.
  // Only binary TLS records traverse the local gateway; the credential is sent
  // after the exact computer certificate has been verified by the inner TLS.
  for (const endpoint of endpoints.slice(0, 2)) {
    const url = localGateway(endpoint);
    if (!url) continue;
    let local: WebSocket | undefined;
    try {
      local = new WebSocket(url, ['agentdeck-lan-v1']);
      const channel = await socketTls(local, fingerprint, 1500);
      return channel;
    } catch (error) {
      local?.close();
      if (/fingerprint|certificate|pin mismatch/i.test(String(error))) throw error;
    }
  }
  const offer = await api<{ tunnelId: string; clientTicket: string }>('/api/v1/relay/tunnels', {
    method: 'POST',
    body: JSON.stringify({ hostId }),
  });
  const socket = new WebSocket(
    `${cloudEndpoint.replace(/^http/, 'ws')}/api/v1/relay/tunnels/${encodeURIComponent(offer.tunnelId)}/client`,
    ['agentdeck-relay-v1', offer.clientTicket],
  );
  socket.binaryType = 'arraybuffer';
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Cloud tunnel timed out'));
    }, 15000);
    const fail = () => {
      clearTimeout(timer);
      reject(new Error('Cloud tunnel unavailable'));
    };
    socket.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    socket.onerror = fail;
    socket.onclose = fail;
  });
  const transport: BinaryTransport = {
    send(bytes) {
      if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_MESSAGE * 2)
        throw new Error('Cloud tunnel unavailable');
      // The relay permits at most 64 KiB per binary frame. TLS records are smaller.
      socket.send(bytes);
    },
    close() {
      socket.close();
    },
    receive(handler, ended) {
      socket.onmessage = (event) => {
        if (!(event.data instanceof ArrayBuffer) || event.data.byteLength > 65536) {
          ended(new Error('Invalid relay frame'));
          return;
        }
        handler(new Uint8Array(event.data));
      };
      socket.onerror = () => ended(new Error('Cloud tunnel failed'));
      socket.onclose = () => ended(new Error('Cloud tunnel closed'));
    },
  };
  try {
    const { connectPinnedTls } = await import('./tls');
    return await connectPinnedTls(transport, fingerprint);
  } catch (error) {
    socket.close();
    throw error;
  }
}
export function localGateway(endpoint: string): string | undefined {
  try {
    const value = new URL(endpoint),
      parts = value.hostname.split('.').map(Number);
    if (
      value.protocol !== 'https:' ||
      value.username ||
      value.password ||
      value.pathname !== '/' ||
      value.search ||
      value.hash ||
      parts.length !== 4 ||
      parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255) ||
      !/^\d+\.\d+\.\d+\.\d+$/.test(value.hostname) ||
      !(
        parts[0] === 10 ||
        (parts[0] === 192 && parts[1] === 168) ||
        (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31)
      ) ||
      !value.port ||
      Number(value.port) >= 65535
    )
      return;
    return `ws://${value.hostname}:${Number(value.port) + 1}/api/v1/lan`;
  } catch {
    return;
  }
}
async function socketTls(
  socket: WebSocket,
  fingerprint: string,
  timeout: number,
): Promise<TlsChannel> {
  socket.binaryType = 'arraybuffer';
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('LAN unavailable'));
    }, timeout);
    const failed = () => {
      clearTimeout(timer);
      reject(new Error('LAN unavailable'));
    };
    socket.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    socket.onerror = failed;
    socket.onclose = failed;
  });
  const timer = setTimeout(() => socket.close(), timeout);
  try {
    const { connectPinnedTls } = await import('./tls');
    return await connectPinnedTls(
      {
        send(bytes) {
          if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_MESSAGE * 2)
            throw new Error('LAN unavailable');
          socket.send(bytes);
        },
        close() {
          socket.close();
        },
        receive(handler, ended) {
          socket.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer && event.data.byteLength <= 65536)
              handler(new Uint8Array(event.data));
            else ended(new Error('Invalid LAN frame'));
          };
          socket.onerror = () => ended(new Error('LAN unavailable'));
          socket.onclose = () => ended(new Error('LAN closed'));
        },
      },
      fingerprint,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function hostPost<T>(
  hostId: string,
  fingerprint: string,
  path: '/api/v1/pair/request' | '/api/v1/pair/claim',
  payload: unknown,
): Promise<T> {
  const channel = await openHostTls(hostId, fingerprint);
  const timeout = setTimeout(() => channel.close(), 15000);
  try {
    const reader = new ByteReader(channel);
    const body = encode(JSON.stringify(payload));
    await channel.write(
      join(
        encode(
          `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n`,
        ),
        body,
      ),
    );
    const response = await responseHeaders(reader);
    let content: Uint8Array;
    const length = response.headers.get('content-length');
    if (length && /^\d+$/.test(length)) content = await reader.exact(Number(length));
    else if (response.headers.get('transfer-encoding') === 'chunked') {
      content = new Uint8Array();
      for (;;) {
        const size = await reader.line();
        if (!/^[0-9a-f]+$/i.test(size)) throw new Error('Invalid HTTP chunk');
        const count = Number.parseInt(size, 16);
        if (!count) break;
        if (content.length + count > MAX_MESSAGE) throw new Error('Host response too large');
        content = join(content, await reader.exact(count));
        if ((await reader.line()) !== '') throw new Error('Invalid HTTP chunk terminator');
      }
    } else throw new Error('Host response has no bounded length');
    const value = JSON.parse(decode(content));
    if (response.status !== 200) throw new Error(value.message || value.code || 'Pairing failed');
    return value;
  } finally {
    clearTimeout(timeout);
    channel.close();
  }
}

export class HostSocket {
  private writing = Promise.resolve();
  private constructor(
    private channel: TlsChannel,
    private reader: ByteReader,
  ) {}

  static async connect(
    hostId: string,
    fingerprint: string,
    credential: string,
    endpoints?: string[],
  ) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(credential)) throw new Error('Invalid host credential');
    const channel = await openHostTls(hostId, fingerprint, endpoints);
    return HostSocket.upgrade(channel, credential);
  }

  static async upgrade(channel: TlsChannel, credential: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(credential)) {
      channel.close();
      throw new Error('Invalid host credential');
    }
    const timeout = setTimeout(() => channel.close(), 15000);
    try {
      const reader = new ByteReader(channel);
      const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
      await channel.write(
        encode(
          `GET /api/v1/ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\nAuthorization: Bearer ${credential}\r\n\r\n`,
        ),
      );
      const response = await responseHeaders(reader);
      const digest = await crypto.subtle.digest(
        'SHA-1',
        encode(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`),
      );
      const expected = btoa(String.fromCharCode(...new Uint8Array(digest)));
      if (
        response.status !== 101 ||
        response.headers.get('upgrade')?.toLowerCase() !== 'websocket' ||
        !response.headers.get('connection')?.toLowerCase().split(/,\s*/).includes('upgrade') ||
        response.headers.get('sec-websocket-accept') !== expected
      )
        throw new Error('Host rejected WebSocket authorization');
      return new HostSocket(channel, reader);
    } catch (error) {
      channel.close();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  send(text: string): Promise<void> {
    return this.frame(1, encode(text));
  }

  private frame(opcode: number, data: Uint8Array): Promise<void> {
    if (data.length > MAX_MESSAGE) return Promise.reject(new Error('Host request too large'));
    const size = data.length < 126 ? 2 : data.length <= 65535 ? 4 : 10;
    const bytes = new Uint8Array(size + 4 + data.length);
    bytes[0] = 0x80 | opcode;
    bytes[1] = 0x80 | (size === 2 ? data.length : size === 4 ? 126 : 127);
    const view = new DataView(bytes.buffer);
    if (size === 4) view.setUint16(2, data.length);
    if (size === 10) view.setBigUint64(2, BigInt(data.length));
    const mask = crypto.getRandomValues(new Uint8Array(4));
    bytes.set(mask, size);
    for (let i = 0; i < data.length; i++) bytes[size + 4 + i] = data[i]! ^ mask[i % 4]!;
    const next = this.writing.then(() => this.channel.write(bytes));
    this.writing = next.catch(() => this.close());
    return next;
  }

  async receive(message: (text: string) => void, ended: (error: Error) => void) {
    let fragments: Uint8Array = new Uint8Array();
    let fragmented = false;
    try {
      for (;;) {
        const header = await this.reader.exact(2);
        const final = (header[0]! & 0x80) !== 0,
          opcode = header[0]! & 15;
        if (header[0]! & 0x70 || header[1]! & 0x80) throw new Error('Invalid host WebSocket frame');
        let length = header[1]! & 127;
        if (length === 126) length = new DataView((await this.reader.exact(2)).buffer).getUint16(0);
        else if (length === 127) {
          const size = new DataView((await this.reader.exact(8)).buffer).getBigUint64(0);
          if (size > BigInt(MAX_MESSAGE)) throw new Error('Host frame too large');
          length = Number(size);
        }
        if (opcode >= 8 && (!final || length > 125)) throw new Error('Invalid host control frame');
        const body = await this.reader.exact(length);
        if (opcode === 8) throw new Error('Host connection closed');
        if (opcode === 9) {
          await this.frame(10, body);
          continue;
        }
        if (opcode === 10) continue;
        if (opcode === 1 && !fragmented) fragmented = true;
        else if (opcode !== 0 || !fragmented) throw new Error('Invalid host text frame');
        if (fragments.length + body.length > MAX_MESSAGE) throw new Error('Host message too large');
        fragments = join(fragments, body);
        if (final) {
          message(decode(fragments));
          fragments = new Uint8Array();
          fragmented = false;
        }
      }
    } catch (error) {
      this.close();
      ended(error instanceof Error ? error : new Error('Invalid host message'));
    }
  }
  close() {
    this.channel.close();
  }
}
