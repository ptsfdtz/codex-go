import { expect, it } from 'vitest';
import { connectPinnedTls } from './tls';
import { tlsHost } from './tls-host.fixture';
import { ByteReader } from './host';

it.each([false, true])(
  'drains the final HTTP response across relay EOF (late reader: %s)',
  async (lateReader) => {
    const body = JSON.stringify({ status: 'approved' });
    const response = `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}`;
    let closeAfterData = false;
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const host = await tlsHost((_data, socket) => {
      closeAfterData = true;
      socket.write(response);
    });
    try {
      const channel = await connectPinnedTls(
        {
          ...host.transport,
          close() {
            host.transport.close();
            resolveClosed();
          },
          receive(handler, ended) {
            host.transport.receive((bytes) => {
              handler(bytes);
              // The WebSocket close can arrive while Web Crypto is still decrypting.
              if (closeAfterData) ended(new Error('Cloud tunnel closed'));
            }, ended);
          },
        },
        host.fingerprint,
      );
      let reader = lateReader ? undefined : new ByteReader(channel);
      await channel.write(new TextEncoder().encode('pair claim'));
      if (lateReader) {
        await closed;
        reader = new ByteReader(channel);
      }
      if (!reader) throw new Error('Missing response reader');
      await expect(reader.line()).resolves.toBe('HTTP/1.1 200 OK');
      expect(await reader.line()).toBe(`Content-Length: ${body.length}`);
      expect(await reader.line()).toBe('');
      expect(new TextDecoder().decode(await reader.exact(body.length))).toBe(body);
      await expect(reader.exact(1)).rejects.toThrow('Cloud tunnel closed');
    } finally {
      await host.close();
    }
  },
  20000,
);

it('negotiates real TLS 1.3 with an ECDSA host and transfers application bytes after pin verification', async () => {
  const host = await tlsHost();
  try {
    const channel = await connectPinnedTls(host.transport, host.fingerprint);
    const response = new Promise<string>((resolve, reject) =>
      channel.receive((bytes) => resolve(new TextDecoder().decode(bytes)), reject),
    );
    await channel.write(new TextEncoder().encode('encrypted host request'));
    expect(await response).toBe('encrypted host request');
    expect(Buffer.concat(host.received).toString()).toBe('encrypted host request');
    channel.close();
  } finally {
    await host.close();
  }
}, 20000);

it('rejects a different certificate without sending any application credential', async () => {
  const host = await tlsHost();
  try {
    await expect(connectPinnedTls(host.transport, '0'.repeat(64))).rejects.toThrow(
      'does not match invitation',
    );
    expect(host.received).toHaveLength(0);
  } finally {
    await host.close();
  }
}, 20000);
