import { expect, it } from 'vitest';
import { connectPinnedTls } from './tls';
import { tlsHost } from './tls-host.fixture';

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
