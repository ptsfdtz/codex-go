// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { HostUpdates, updatePrompt, type HostRelease } from './HostUpdates';
import type { Request } from '../workspace';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
const release: HostRelease = {
  current: 'host-old',
  latest: 'host-new',
  platform: 'windows',
  installation: 'release',
  updateAvailable: true,
};

async function mount(value: HostRelease, supported = true) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const request = vi.fn().mockResolvedValue(value);
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <HostUpdates
        request={request as Request}
        supported={supported}
        disabled={false}
        name="电脑一"
        projects={[{ projectId: 'p1', name: '项目一' }]}
        onUpdate={onUpdate}
      />,
    );
  });
  return { root, container, request, onUpdate };
}

it('checks without sending, previews the prompt, and submits only on explicit confirmation', async () => {
  const { root, container, request, onUpdate } = await mount(release);
  expect(request).toHaveBeenCalledWith('system.updateCheck');
  expect(container.textContent).toContain('电脑一 需要更新');
  expect(onUpdate).not.toHaveBeenCalled();
  await act(async () => {
    container.querySelector('button')!.click();
  });
  expect(document.body.textContent).toContain('不要盲目向默认目录安装第二份 Host');
  expect(onUpdate).not.toHaveBeenCalled();
  await act(async () => {
    [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent === '发送更新提示词')!
      .click();
  });
  expect(onUpdate).toHaveBeenCalledExactlyOnceWith(updatePrompt(release), 'p1');
  await act(async () => {
    root.unmount();
  });
});
it('does not label a development or current build as needing an update', async () => {
  for (const value of [
    { ...release, installation: 'development' as const },
    { ...release, current: 'host-new', updateAvailable: false },
  ]) {
    const { root, container, onUpdate } = await mount(value);
    expect(container.textContent).toBe('');
    expect(onUpdate).not.toHaveBeenCalled();
    await act(async () => {
      root.unmount();
    });
  }
});
it('supports old Hosts without calling an unknown RPC or claiming their version is outdated', async () => {
  const { root, container, request } = await mount(release, false);
  expect(request).not.toHaveBeenCalled();
  expect(container.textContent).toContain('版本待确认');
  expect(container.textContent).not.toContain('需要更新');
  await act(async () => {
    root.unmount();
  });
});
