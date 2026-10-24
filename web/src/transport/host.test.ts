import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { connectPinnedTls } from './tls';
import { HostSocket } from './host';
import { tlsHost } from './tls-host.fixture';

it('upgrades inside TLS, masks client frames, receives fragmented text, and replies to pings', async () => {
  let upgraded = false;
  let requestHeaders = '';
  let buffered = Buffer.alloc(0);
  let pong = false;
  let resolveRequest!: (value: string) => void;
  const request = new Promise<string>((resolve) => {
    resolveRequest = resolve;
  });
  const host = await tlsHost((data, socket) => {
    buffered = Buffer.concat([buffered, data]);
    if (!upgraded) {
      const end = buffered.indexOf('\r\n\r\n');
      if (end < 0) return;
      requestHeaders = buffered.subarray(0, end).toString();
      buffered = buffered.subarray(end + 4);
      const key = /Sec-WebSocket-Key: (.+)\r?/.exec(requestHeaders)?.[1]?.trim();
      const accept = createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      // Interleave a ping between two fragments of a single text message.
      socket.write(Buffer.from([0x01, 3, 97, 98, 99, 0x89, 0, 0x80, 3, 100, 101, 102]));
      upgraded = true;
    }
    while (buffered.length >= 2) {
      const opcode = buffered[0]! & 15;
      expect(buffered[1]! & 0x80).toBe(0x80);
      let size = buffered[1]! & 127,
        offset = 2;
      if (size === 126) {
        if (buffered.length < 4) return;
        size = buffered.readUInt16BE(2);
        offset = 4;
      } else if (size === 127) {
        if (buffered.length < 10) return;
        size = Number(buffered.readBigUInt64BE(2));
        offset = 10;
      }
      if (buffered.length < offset + 4 + size) return;
      const mask = buffered.subarray(offset, offset + 4);
      const body = Buffer.from(buffered.subarray(offset + 4, offset + 4 + size));
      for (let i = 0; i < body.length; i++) body[i] = body[i]! ^ mask[i % 4]!;
      buffered = buffered.subarray(offset + 4 + size);
      if (opcode === 10) pong = true;
      if (opcode === 1) resolveRequest(body.toString());
    }
  });
  try {
    const channel = await connectPinnedTls(host.transport, host.fingerprint);
    const socket = await HostSocket.upgrade(channel, 'a'.repeat(43));
    const incoming = new Promise<string>((resolve, reject) => {
      void socket.receive(resolve, reject);
    });
    expect(await incoming).toBe('abcdef');
    const large = 'request-'.repeat(10000);
    await socket.send(large);
    expect(await request).toBe(large);
    expect(pong).toBe(true);
    expect(requestHeaders).toContain(`Authorization: Bearer ${'a'.repeat(43)}`);
    expect(requestHeaders).not.toMatch(/Origin:/i);
    socket.close();
  } finally {
    await host.close();
  }
}, 20000);

it('rejects a forged WebSocket upgrade even after the TLS peer is authenticated', async () => {
  const host = await tlsHost((_data, socket) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: forged\r\n\r\n',
    );
  });
  try {
    const channel = await connectPinnedTls(host.transport, host.fingerprint);
    await expect(HostSocket.upgrade(channel, 'a'.repeat(43))).rejects.toThrow('rejected WebSocket');
  } finally {
    await host.close();
  }
}, 20000);
