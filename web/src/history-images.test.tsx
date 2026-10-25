// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RichContent } from './RichContent';
import { readHistoryImage } from './media';
import type { Bridge } from './transport/bridge';

vi.mock('./media', () => ({ readHistoryImage: vi.fn() }));

it.each(['imageView', 'imageGeneration', 'userMessage'])(
  'loads %s images only inside an expanded disclosure and cancels on collapse',
  async (type) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const read = vi.mocked(readHistoryImage);
    read.mockReset();
    read.mockImplementation(() => new Promise(() => {}));
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <RichContent
            connection={{} as Bridge}
            sessionId="session"
            entry={{
              turnId: 'turn',
              item: {
                id: 'item',
                type,
                ...(type === 'userMessage'
                  ? { content: [{ type: 'localImage', path: '/uploaded.png' }] }
                  : {}),
              },
            }}
          />,
        ),
      );
      expect(read).not.toHaveBeenCalled();
      expect(container.querySelector('.saved-image')).toBeNull();
      expect(container.textContent).not.toContain('读取历史图片');
      const details = container.querySelector('details')!;
      await act(async () => {
        details.open = true;
        details.dispatchEvent(new Event('toggle'));
      });
      expect(read).toHaveBeenCalledTimes(1);
      expect(read.mock.calls[0]!.slice(1, 5)).toEqual(['session', 'turn', 'item', 0]);
      const current = read.mock.calls[0]![5];
      expect(current()).toBe(true);
      await act(async () => {
        details.open = false;
        details.dispatchEvent(new Event('toggle'));
      });
      expect(current()).toBe(false);
      expect(container.querySelector('.saved-image')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);
