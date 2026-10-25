import { makeTLSClient, setCryptoImplementation } from '@reclaimprotocol/tls';
import { webcryptoCrypto } from '@reclaimprotocol/tls/webcrypto';

setCryptoImplementation(webcryptoCrypto);

export interface BinaryTransport {
  send(bytes: Uint8Array): Promise<void> | void;
  close(): void;
  receive(handler: (bytes: Uint8Array) => void, ended: (error: Error) => void): void;
}

export interface TlsChannel {
  write(bytes: Uint8Array): Promise<void>;
  close(): void;
  receive(handler: (bytes: Uint8Array) => void, ended: (error: Error) => void): void;
}

const MAX_BUFFER = 2 * 1024 * 1024;
const quiet = { debug() {}, info() {}, warn() {}, error() {}, trace() {} };

export function certificateBytes(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

// The invitation pins the host's self-signed certificate, exactly as Android
// does. The TLS implementation still verifies CertificateVerify and Finished.
// No application bytes or pairing credentials leave before pin verification.
export async function connectPinnedTls(
  transport: BinaryTransport,
  fingerprint: string,
): Promise<TlsChannel> {
  if (!/^[a-f0-9]{64}$/i.test(fingerprint)) {
    transport.close();
    throw new Error('Invalid certificate pin');
  }
  let pin: Promise<void> | undefined;
  let closed: Error | undefined;
  let ready = false;
  let queuedBytes = 0;
  let incomingBytes = 0;
  const queued: Uint8Array[] = [];
  let receiver: ((bytes: Uint8Array) => void) | undefined;
  let ended: ((error: Error) => void) | undefined;
  let resolveHandshake!: () => void;
  let rejectHandshake!: (error: Error) => void;
  const handshake = new Promise<void>((resolve, reject) => {
    resolveHandshake = resolve;
    rejectHandshake = reject;
  });
  const finish = (error: Error) => {
    if (closed) return;
    closed = error;
    transport.close();
    rejectHandshake(error);
    ended?.(error);
  };
  const fail = (error: Error) => {
    if (closed) return;
    queued.length = 0;
    queuedBytes = 0;
    finish(error);
  };
  const deliver = (bytes: Uint8Array) => {
    if (closed) return;
    if (!ready || !receiver) {
      queuedBytes += bytes.length;
      if (queuedBytes > MAX_BUFFER) {
        fail(new Error('TLS receive buffer exceeded'));
        return;
      }
      queued.push(bytes.slice());
    } else receiver(bytes);
  };
  const flush = () => {
    if (!ready || !receiver) return;
    for (const bytes of queued.splice(0)) receiver(bytes);
    queuedBytes = 0;
  };
  const tls = makeTLSClient({
    host: '127.0.0.1',
    supportedProtocolVersions: ['TLS1_3'],
    namedCurves: ['SECP256R1'],
    cipherSuites: ['TLS_AES_128_GCM_SHA256', 'TLS_AES_256_GCM_SHA384'],
    applicationLayerProtocols: ['http/1.1'],
    verifyServerCertificate: false, // Replaced with the invitation pin below.
    logger: quiet,
    async write({ header, content }) {
      if (closed) throw closed;
      await transport.send(header);
      await transport.send(content);
    },
    onRecvCertificates({ certificates }) {
      const leaf = certificates[0];
      if (pin || !leaf || !leaf.isWithinValidity()) throw new Error('Invalid host certificate');
      pin = sha256(certificateBytes(leaf.serialiseToPem())).then((actual) => {
        if (actual !== fingerprint.toLowerCase())
          throw new Error('Host certificate does not match invitation');
      });
      // Observe rejection immediately; the handshake waits for this below.
      void pin.catch(fail);
    },
    onHandshake() {
      if (!pin) {
        fail(new Error('Host did not supply a certificate'));
        return;
      }
      void pin
        .then(() => {
          if (closed) return;
          ready = true;
          resolveHandshake();
          flush();
        })
        .catch(fail);
    },
    onApplicationData: deliver,
    onTlsEnd(error) {
      if (error) fail(error);
      else finish(new Error('Host TLS connection closed'));
    },
  });
  let reading = Promise.resolve();
  let transportEnded = false;
  transport.receive(
    (bytes) => {
      if (transportEnded || closed) return;
      incomingBytes += bytes.length;
      if (incomingBytes > MAX_BUFFER) {
        fail(new Error('TLS input buffer exceeded'));
        return;
      }
      reading = reading
        .then(async () => {
          if (!closed) await tls.handleReceivedBytes(bytes);
        })
        .catch((error) => fail(error instanceof Error ? error : new Error('Invalid TLS record')))
        .finally(() => {
          incomingBytes -= bytes.length;
        });
    },
    (error) => {
      if (transportEnded) return;
      transportEnded = true;
      // Web Crypto is asynchronous: EOF must follow all preceding TLS records.
      // Keep authenticated plaintext available for a reader attached after EOF.
      void reading.then(() => finish(error));
    },
  );
  const timer = globalThis.setTimeout(() => fail(new Error('Host TLS handshake timed out')), 15000);
  try {
    await Promise.all([tls.startHandshake().catch(fail), handshake]);
  } finally {
    globalThis.clearTimeout(timer);
  }
  let writing = Promise.resolve();
  return {
    write(bytes) {
      const next = writing.then(async () => {
        if (closed) throw closed;
        await tls.write(bytes);
      });
      writing = next.catch(fail);
      return next;
    },
    close() {
      fail(new Error('Host connection closed'));
    },
    receive(handler, onEnd) {
      receiver = handler;
      ended = onEnd;
      flush();
      if (closed) onEnd(closed);
    },
  };
}
