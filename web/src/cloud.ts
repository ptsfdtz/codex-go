export const cloudOrigin = (
  import.meta.env.VITE_CLOUD_ORIGIN || 'https://agent.ptsfdtz.top'
).replace(/\/$/, '');

let csrf = '';
let refreshing: Promise<boolean> | undefined;

// The cloud cookie belongs to the cloud origin. Pages cannot read it through
// document.cookie; obtain only the CSRF token over the allowlisted CORS route.
async function csrfToken(): Promise<string> {
  if (!csrf) {
    const response = await fetch(`${cloudOrigin}/api/v1/web/csrf`, { credentials: 'include' });
    if (response.ok) csrf = (await response.json()).csrfToken || '';
  }
  return csrf;
}

function rememberCsrf(body: { csrfToken?: string }) {
  if (body.csrfToken) csrf = body.csrfToken;
}

async function refresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const token = await csrfToken();
      if (!token) return false;
      const response = await fetch(`${cloudOrigin}/api/v1/web/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': token },
      });
      if (!response.ok) {
        csrf = '';
        return false;
      }
      rememberCsrf(await response.json());
      return true;
    })().finally(() => {
      refreshing = undefined;
    });
  }
  return refreshing;
}

export async function api<T = Record<string, unknown>>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  const write = !['GET', 'HEAD'].includes((init.method || 'GET').toUpperCase());
  if (write && path !== '/api/v1/web/login') headers.set('x-csrf-token', await csrfToken());
  const response = await fetch(`${cloudOrigin}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });
  if (response.status === 401 && retry && path !== '/api/v1/web/login' && (await refresh())) {
    return api<T>(path, init, false);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.code || 'Cloud request failed');
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
