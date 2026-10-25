import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testLocks } from '../tests/locks';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('navigator', { locks: testLocks() });
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) || null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

it('uses a stable 32-byte installation token accepted by the native cloud validator', async () => {
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) || null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
  const { installationId } = await import('./cloud');
  const first = installationId();
  expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(installationId()).toBe(first);
});

it('recovers cross-origin CSRF on reload, refreshes once, and attaches the rotated token to writes', async () => {
  let refreshed = false;
  let refreshCalls = 0;
  const writes: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      expect(init.credentials).toBe('include');
      if (url.endsWith('/web/csrf'))
        return json({ csrfToken: refreshed ? 'new-csrf' : 'old-csrf' });
      if (url.endsWith('/web/refresh')) {
        expect(new Headers(init.headers).get('x-csrf-token')).toBe('old-csrf');
        refreshCalls++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        refreshed = true;
        return json({ csrfToken: 'new-csrf' });
      }
      if (init.method === 'DELETE')
        writes.push(new Headers(init.headers).get('x-csrf-token') || '');
      return refreshed ? json({ ok: true }) : json({ code: 'UNAUTHORIZED' }, 401);
    }),
  );
  const { api } = await import('./cloud');
  await Promise.all([api('/api/v1/hosts'), api('/api/v1/devices')]);
  expect(refreshCalls).toBe(1);
  await api('/api/v1/devices/web-device', { method: 'DELETE' });
  expect(writes).toEqual(['new-csrf']);
});

it('coordinates rotation between independent tab modules using the shared browser lock', async () => {
  let valid = false,
    rotations = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/web/csrf')) return json({ csrfToken: valid ? 'new' : 'old' });
      if (url.endsWith('/web/refresh')) {
        rotations++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        valid = true;
        return json({ csrfToken: 'new' });
      }
      return valid ? json({ ok: true }) : json({}, 401);
    }),
  );
  const first = await import('./cloud');
  vi.resetModules();
  const second = await import('./cloud');
  await Promise.all([first.api('/api/v1/hosts'), second.api('/api/v1/devices')]);
  expect(rotations).toBe(1);
});

it('keeps login failures visible and never retries a password submission', async () => {
  const fetch = vi.fn(async () => json({ message: 'Invalid credentials' }, 401));
  vi.stubGlobal('fetch', fetch);
  const { api } = await import('./cloud');
  await expect(api('/api/v1/web/login', { method: 'POST', body: '{}' })).rejects.toThrow(
    'Invalid credentials',
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('cancels a queued write when login changes the cookie account before its lock is acquired', async () => {
  const fetch = vi.fn(async () => json({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  const { api } = await import('./cloud');
  const login = api('/api/v1/web/login', { method: 'POST', body: '{}' });
  const queued = api('/api/v1/devices/old-account-device', { method: 'DELETE' });
  await expect(queued).rejects.toThrow('账户已变化');
  await login;
  expect(fetch).toHaveBeenCalledTimes(1);
});
