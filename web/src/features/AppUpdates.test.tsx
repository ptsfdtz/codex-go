// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AppUpdates } from './AppUpdates';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.body.innerHTML = '';
});

it('offers an explicit reload for a new build and preserves the page when cancelled', async () => {
  vi.stubEnv('PROD', true);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('__AGENTDECK_WEB_VERSION__', 'a'.repeat(64));
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ version: 'b'.repeat(64) }) });
  vi.stubGlobal('fetch', fetch);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<AppUpdates />);
  });
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining('version.json'),
    expect.objectContaining({ cache: 'no-store', credentials: 'omit' }),
  );
  const reload = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === '重新加载更新',
  );
  expect(reload).toBeDefined();
  expect(confirm).not.toHaveBeenCalled();
  await act(async () => {
    reload!.click();
  });
  expect(confirm).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('发现新版本');
  await act(async () => {
    root.unmount();
  });
  confirm.mockRestore();
});

it('does not offer reload on malformed update responses', async () => {
  vi.stubEnv('PROD', true);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('__AGENTDECK_WEB_VERSION__', 'a'.repeat(64));
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '<html>' }) }),
  );
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(<AppUpdates />);
  });
  expect(container.textContent).toContain('检查更新失败');
  expect(container.textContent).not.toContain('重新加载更新');
  await act(async () => {
    root.unmount();
  });
});
