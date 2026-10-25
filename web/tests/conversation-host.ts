// Local browser acceptance adapter. Never included in a production build.
import type { Packet } from '../src/transport/bridge';
export const installationId = () => 'local-test';
export const accountEvent = 'test-account-changed';
export async function api(path: string) {
  if (path.endsWith('/session')) return { accountId: 'local', cloudDeviceId: 'test' };
  if (path.endsWith('/access'))
    return { hostId: 'local', fingerprint: 'a'.repeat(64), credential: 'b'.repeat(43) };
  if (path.endsWith('/hosts'))
    return { hosts: [{ hostId: 'local', displayName: '本地验收电脑', online: true }] };
  return { devices: [] };
}
export const forgetGrant = async () => {};
export const loadGrant = async () => ({ hostId: 'local' });
export class Bridge {
  get awaitingReceipt() {
    return localStorage.getItem('test-receipt') === 'pending';
  }
  async reconcile() {
    const result = await this.request<{ status: string }>('__test_receipt', {});
    if (result.status === 'done') localStorage.removeItem('test-receipt');
  }
  private handler?: (packet: Packet) => void;
  private listener = (event: Event) => this.handler?.((event as CustomEvent<Packet>).detail);
  async connect() {
    window.addEventListener('test-packet', this.listener);
    if (this.awaitingReceipt) await this.reconcile();
  }
  onEvent(handler: (packet: Packet) => void) {
    this.handler = handler;
  }
  close() {
    window.removeEventListener('test-packet', this.listener);
  }
  async request<T>(action: string, payload: unknown): Promise<T> {
    const result = await fetch('/__test_rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, payload }),
    });
    const body = await result.json();
    if (!result.ok) {
      if (action === 'turn.start' && String(body.error).includes('OUTCOME_UNKNOWN'))
        localStorage.setItem('test-receipt', 'pending');
      throw new Error(body.error);
    }
    return body;
  }
}
