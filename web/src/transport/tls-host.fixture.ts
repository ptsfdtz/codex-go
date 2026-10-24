import { once } from 'node:events';
import { connect } from 'node:net';
import { createServer } from 'node:tls';
import { X509CertificateGenerator } from '@peculiar/x509';
import { certificateBytes, sha256, type BinaryTransport } from './tls';

export async function tlsHost(
  onBytes?: (data: Buffer, socket: import('node:tls').TLSSocket) => void,
) {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const certificate = await X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=127.0.0.1',
    notBefore: new Date(Date.now() - 60000),
    notAfter: new Date(Date.now() + 60000),
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    keys,
  });
  const keyBytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  const key = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(keyBytes).toString('base64')}\n-----END PRIVATE KEY-----`;
  const cert = certificate.toString('pem');
  const received: Buffer[] = [];
  const server = createServer(
    { key, cert, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' },
    (socket) => {
      socket.on('error', () => {});
      socket.on('data', (data) => {
        received.push(data);
        if (onBytes) onBytes(data, socket);
        else socket.write(data);
      });
    },
  );
  server.on('tlsClientError', () => {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test listener');
  const socket = connect(address.port, '127.0.0.1');
  await once(socket, 'connect');
  const transport: BinaryTransport = {
    send(bytes) {
      socket.write(bytes);
    },
    close() {
      socket.destroy();
    },
    receive(handler, ended) {
      socket.on('data', (bytes) => handler(new Uint8Array(bytes)));
      socket.on('error', ended);
      socket.on('close', () => ended(new Error('Socket closed')));
    },
  };
  return {
    transport,
    received,
    fingerprint: await sha256(certificateBytes(cert)),
    async close() {
      socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
