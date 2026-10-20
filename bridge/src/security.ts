import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual, X509Certificate } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { invariant, DeckError } from './errors.js';
import { nativeHelper } from './native.js';

export const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
export const token = (): string => randomBytes(32).toString('base64url');
export function equalHash(a: string, b: string): boolean {
  return (
    /^[a-f0-9]{64}$/.test(a) &&
    /^[a-f0-9]{64}$/.test(b) &&
    timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  );
}
export interface SecretProtector {
  protect(value: Buffer): Promise<Buffer>;
  unprotect(value: Buffer): Promise<Buffer>;
}
export class Dpapi implements SecretProtector {
  private run(operation: string, value: Buffer): Promise<Buffer> {
    invariant(
      process.platform === 'win32',
      'UNSUPPORTED_PLATFORM',
      'Persistent production secrets require Windows DPAPI',
    );
    return new Promise((resolveResult, reject) => {
      const child = spawn(nativeHelper('Dpapi'), [operation], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      let length = 0;
      const timer = setTimeout(() => child.kill(), 10000);
      child.stdout.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > 65536) child.kill();
        else output += chunk.toString();
      });
      child.stderr.on('data', () => {});
      child.on('error', () => {
        clearTimeout(timer);
        reject(new DeckError('SECRET_STORE_ERROR', 'Windows DPAPI helper failed'));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0)
          reject(new DeckError('SECRET_STORE_ERROR', 'Windows DPAPI operation failed'));
        else resolveResult(Buffer.from(output.trim(), 'base64'));
      });
      child.stdin.end(value.toString('base64'));
    });
  }
  protect(value: Buffer): Promise<Buffer> {
    return this.run('protect', value);
  }
  unprotect(value: Buffer): Promise<Buffer> {
    return this.run('unprotect', value);
  }
}
export async function restrictDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const sid = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
      windowsHide: true,
    }).match(/S-1-5-[0-9-]+/)?.[0];
    invariant(sid, 'SECRET_STORE_ERROR', 'Cannot determine Windows user SID');
    execFileSync(
      'icacls.exe',
      [path, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'],
      { windowsHide: true, stdio: 'ignore' },
    );
  }
}
export function localAddresses(): string[] {
  return [
    ...new Set(
      Object.values(networkInterfaces())
        .flatMap((entries) => entries ?? [])
        .filter(
          (e) =>
            e.family === 'IPv4' &&
            !e.internal &&
            /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(e.address),
        )
        .map((e) => e.address),
    ),
  ];
}
export function restoreListenAddress(
  saved: string | undefined,
  cert: string,
  assigned: readonly string[] = localAddresses(),
): string {
  if (!saved || saved === '127.0.0.1' || !assigned.includes(saved)) return '127.0.0.1';
  return new X509Certificate(cert).checkIP(saved) ? saved : '127.0.0.1';
}
export async function certificate(
  directory: string,
  protector: SecretProtector,
): Promise<{ cert: string; key: string; fingerprint: string }> {
  const file = join(directory, 'tls.dpapi');
  try {
    const stored = JSON.parse((await protector.unprotect(await readFile(file))).toString()) as {
      cert: string;
      key: string;
    };
    const cert = new X509Certificate(stored.cert);
    invariant(
      Date.parse(cert.validTo) > Date.now() + 86400000,
      'CERTIFICATE_EXPIRED',
      'Certificate is expiring; renew locally and pair again',
    );
    return { ...stored, fingerprint: createHash('sha256').update(cert.raw).digest('hex') };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const stored = JSON.parse(
    execFileSync(nativeHelper('Certificate'), [], {
      input: JSON.stringify(['127.0.0.1', ...localAddresses()]),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 65536,
    }),
  ) as { cert: string; key: string };
  await writeFile(file, await protector.protect(Buffer.from(JSON.stringify(stored))), {
    mode: 0o600,
    flag: 'wx',
  });
  return {
    ...stored,
    fingerprint: createHash('sha256').update(new X509Certificate(stored.cert).raw).digest('hex'),
  };
}
