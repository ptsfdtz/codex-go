import { exclusive } from './coordination';

export const cloudOrigin = (
  import.meta.env.VITE_CLOUD_ORIGIN || 'https://agent.ptsfdtz.top'
).replace(/\/$/, '');

let csrf = '';

// The cloud cookie belongs to the cloud origin. Pages cannot read it through
// document.cookie; obtain only the CSRF token over the allowlisted CORS route.
async function csrfToken(): Promise<string> {
  if (!csrf) {
    const response = await fetch(`${cloudOrigin}/api/v1/web/csrf`, {
      credentials: 'include',
      signal: AbortSignal.timeout(15000),
    });
    if (response.ok) csrf = (await response.json()).csrfToken || '';
  }
  return csrf;
}

function rememberCsrf(body: { csrfToken?: string }) {
  if (body.csrfToken) csrf = body.csrfToken;
}

export class CloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}
export const accountEvent = 'agentdeck-account-changed';
const accountKey = 'agentdeck.web.account-change.v1';
export function notifyAccountChange() {
  csrf = '';
  localStorage.setItem(accountKey, crypto.randomUUID());
  window.dispatchEvent(new Event(accountEvent));
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === accountKey) {
      csrf = '';
      window.dispatchEvent(new Event(accountEvent));
    }
  });
}
async function refresh(): Promise<boolean> {
  const session = await fetch(cloudOrigin + '/api/v1/web/session', {
    credentials: 'include',
    signal: AbortSignal.timeout(15000),
  });
  csrf = '';
  if (session.ok) {
    rememberCsrf(await session.json());
    return true;
  }
  if (session.status !== 401) return false;
  const token = await csrfToken();
  if (!token) return false;
  const response = await fetch(cloudOrigin + '/api/v1/web/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { 'x-csrf-token': token },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    csrf = '';
    if (response.status === 401 && typeof window !== 'undefined') notifyAccountChange();
    return false;
  }
  rememberCsrf(await response.json());
  return true;
}
function accountGeneration() {
  return typeof window === 'undefined' ? '' : localStorage.getItem(accountKey) || '';
}

export async function api<T = Record<string, unknown>>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const generation = accountGeneration();
  return exclusive('cloud-auth.' + cloudOrigin, async () => {
    if (generation !== accountGeneration())
      throw new CloudError('账户已变化，请重新加载页面', 401, 'ACCOUNT_CHANGED');
    // Serialize cookie-dependent requests with login/logout/rotation so a queued
    // write cannot acquire another account's cookie between CSRF and dispatch.
    csrf = '';
    let result: T;
    try {
      result = await request<T>(path, init);
    } catch (error) {
      if (
        error instanceof CloudError &&
        error.status === 401 &&
        retry &&
        path !== '/api/v1/web/login' &&
        (await refresh())
      )
        result = await request<T>(path, init);
      else throw error;
    }
    if (
      ['/api/v1/web/login', '/api/v1/web/logout', '/api/v1/web/password'].includes(path) ||
      (init.method?.toUpperCase() === 'DELETE' && path.startsWith('/api/v1/devices/'))
    )
      notifyAccountChange();
    return result;
  });
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  const write = !['GET', 'HEAD'].includes((init.method || 'GET').toUpperCase());
  if (write && path !== '/api/v1/web/login') headers.set('x-csrf-token', await csrfToken());
  const response = await fetch(`${cloudOrigin}${path}`, {
    ...init,
    credentials: 'include',
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
    headers,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new CloudError(
      body.message || body.code || 'Cloud request failed',
      response.status,
      body.code,
    );
  rememberCsrf(body);
  if (path === '/api/v1/web/logout') csrf = '';
  return body;
}

export function installationId(): string {
  const key = 'agentdeck.web.installation.v1';
  const saved = localStorage.getItem(key);
  if (saved && /^[A-Za-z0-9_-]{43}$/.test(saved)) return saved;
  const token = randomToken();
  localStorage.setItem(key, token);
  return token;
}

export function randomToken(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
