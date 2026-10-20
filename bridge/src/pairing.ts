import { EventEmitter } from 'node:events';
import { Store, now, uid } from './store.js';
import { digest, token, equalHash, type SecretProtector } from './security.js';
import { pairingRequest } from '@agentdeck/protocol';
import { invariant } from './errors.js';

interface Invite {
  tokenHash: string;
  expiresAt: number;
  endpoint: string;
  fingerprint: string;
  used: boolean;
}
interface Pending {
  requestId: string;
  claimHash: string;
  displayName: string;
  nonce: string;
  code: string;
  expiresAt: number;
  status: 'pending' | 'approved' | 'rejected';
  protectedCredential?: Buffer;
  deviceId?: string;
}
export class Pairing extends EventEmitter {
  private invite: Invite | null = null;
  private pending: Pending | null = null;
  constructor(
    private readonly store: Store,
    private readonly protector: SecretProtector,
  ) {
    super();
  }
  createLocal(endpoint: string, fingerprint: string): Record<string, unknown> {
    invariant(endpoint.startsWith('https://'), 'CONFIG_ERROR', 'Pairing requires TLS');
    const value = token();
    this.invite = {
      tokenHash: digest(value),
      expiresAt: Date.now() + 120000,
      endpoint,
      fingerprint,
      used: false,
    };
    this.pending = null;
    return {
      v: 1,
      endpoint,
      fingerprint,
      token: value,
      expiresAt: new Date(this.invite.expiresAt).toISOString(),
      hostId: this.store.meta('hostId'),
    };
  }
  request(value: unknown): {
    requestId: string;
    claimToken: string;
    code: string;
    expiresAt: string;
  } {
    const input = pairingRequest.parse(value);
    const invite = this.invite;
    invariant(
      invite &&
        !invite.used &&
        invite.expiresAt > Date.now() &&
        equalHash(invite.tokenHash, digest(input.token)),
      'PAIRING_EXPIRED',
      'Pairing invitation invalid, used or expired',
    );
    invite.used = true;
    const claimToken = token();
    const requestId = uid('pair');
    const code = String(
      parseInt(digest(requestId + input.nonce + invite.tokenHash).slice(0, 12), 16) % 1000000,
    ).padStart(6, '0');
    this.pending = {
      requestId,
      claimHash: digest(claimToken),
      displayName: input.displayName,
      nonce: input.nonce,
      code,
      expiresAt: invite.expiresAt,
      status: 'pending',
    };
    this.emit('confirmation', {
      requestId,
      displayName: input.displayName,
      code,
      expiresAt: new Date(invite.expiresAt).toISOString(),
    });
    return { requestId, claimToken, code, expiresAt: new Date(invite.expiresAt).toISOString() };
  }
  async confirmLocal(requestId: string, approve: boolean): Promise<void> {
    const pending = this.pending;
    invariant(
      pending?.requestId === requestId &&
        pending.status === 'pending' &&
        pending.expiresAt > Date.now(),
      'PAIRING_EXPIRED',
      'Pairing request expired',
    );
    if (!approve) {
      pending.status = 'rejected';
      return;
    }
    const credential = token();
    const deviceId = uid('device');
    pending.protectedCredential = await this.protector.protect(Buffer.from(credential));
    invariant(
      this.pending === pending && pending.expiresAt > Date.now(),
      'PAIRING_EXPIRED',
      'Pairing expired during confirmation',
    );
    this.store.db.transaction(() => {
      this.store.db.prepare('UPDATE devices SET revokedAt=? WHERE revokedAt IS NULL').run(now());
      this.store.db
        .prepare('INSERT INTO devices VALUES(?,?,?,?,NULL)')
        .run(deviceId, pending.displayName, digest(credential), now());
    })();
    pending.deviceId = deviceId;
    pending.status = 'approved';
    this.emit('devicesChanged');
  }
  async claim(requestId: string, claimToken: string): Promise<Record<string, unknown>> {
    const pending = this.pending;
    invariant(
      pending?.requestId === requestId &&
        pending.expiresAt > Date.now() &&
        equalHash(pending.claimHash, digest(claimToken)),
      'PAIRING_EXPIRED',
      'Pairing claim invalid or expired',
    );
    if (pending.status !== 'approved') return { status: pending.status };
    invariant(pending.protectedCredential, 'PAIRING_EXPIRED', 'Credential already claimed');
    const protectedCredential = pending.protectedCredential;
    delete pending.protectedCredential;
    this.pending = null;
    return {
      status: 'approved',
      deviceId: pending.deviceId,
      credential: (await this.protector.unprotect(protectedCredential)).toString(),
      hostId: this.store.meta('hostId'),
    };
  }
  authenticate(credential: string): { deviceId: string; displayName: string } | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(credential)) return null;
    return (
      (this.store.db
        .prepare(
          'SELECT deviceId,displayName FROM devices WHERE credentialHash=? AND revokedAt IS NULL',
        )
        .get(digest(credential)) as { deviceId: string; displayName: string } | undefined) ?? null
    );
  }
  revokeLocal(deviceId: string): void {
    this.store.db
      .prepare('UPDATE devices SET revokedAt=? WHERE deviceId=? AND revokedAt IS NULL')
      .run(now(), deviceId);
    this.emit('devicesChanged');
  }
  close(): void {
    this.invite = null;
    this.pending = null;
  }
}
