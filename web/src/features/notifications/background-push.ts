import { accountEvent, api } from '../../cloud';

export type PushConfig = {
  available: boolean;
  publicKey?: string;
  endpointHash?: string;
  includeCompletion?: boolean;
};
const marker = 'agentdeck.web.push.account';
if (typeof window !== 'undefined')
  window.addEventListener(accountEvent, (event) => {
    if (['logout', 'expired'].includes((event as CustomEvent<string>).detail)) {
      try {
        localStorage.removeItem(marker);
      } catch {
        /* Browser storage is optional. */
      }
    }
  });
export function pushOwner(scope: string) {
  const [accountId, deviceId] = scope.split(':');
  return { accountId, deviceId };
}
export function subscribedHere(scope: string) {
  try {
    return (
      !!scope && localStorage.getItem(marker) === scope && Notification.permission === 'granted'
    );
  } catch {
    return false;
  }
}
export function markSubscription(scope: string, enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(marker, scope);
    else if (localStorage.getItem(marker) === scope) localStorage.removeItem(marker);
  } catch {
    /* The server remains authoritative for subscription ownership. */
  }
}
export function pushConfig() {
  return api<PushConfig>('/api/v1/web/push');
}
export async function subscriptionMatches(
  config: PushConfig,
  registration?: ServiceWorkerRegistration,
) {
  if (!config.available || !config.endpointHash || !registration) return false;
  const sub = await registration.pushManager.getSubscription();
  if (!sub) return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint));
  return (
    config.endpointHash ===
    Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  );
}
export function pushKey(encoded: string) {
  return Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );
}
