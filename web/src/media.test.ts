import { expect, it, vi } from 'vitest';
import { attachmentsFromFiles, readHistoryImage } from './media';
import type { Bridge } from './transport/bridge';
it('rejects an executable renamed to an image and the combined attachment limit', async () => {
  await expect(
    attachmentsFromFiles([new File(['MZ executable'], 'fake.png', { type: 'image/png' })], []),
  ).rejects.toThrow('仅支持');
  await expect(
    attachmentsFromFiles([new File([new Uint8Array(512 * 1024 + 1)], 'large.png')], []),
  ).rejects.toThrow('512 KiB');
});
it('rejects a history resource returned for another session before displaying bytes', async () => {
  const connection = {
    request: vi.fn().mockResolvedValue({ sessionId: 'other' }),
  } as unknown as Bridge;
  await expect(
    readHistoryImage(connection, 'session', 'turn', 'item', 0, () => true),
  ).rejects.toThrow('资源描述');
});
it('checks the resource digest instead of trusting declared image metadata', async () => {
  const connection = {
    request: vi.fn().mockResolvedValue({
      sessionId: 's',
      turnId: 't',
      itemId: 'i',
      contentIndex: 0,
      offset: 0,
      totalBytes: 8,
      data: 'iVBORw0KGgo=',
      nextOffset: null,
      sha256: '0'.repeat(64),
      mime: 'image/png',
    }),
  } as unknown as Bridge;
  await expect(readHistoryImage(connection, 's', 't', 'i', 0, () => true)).rejects.toThrow(
    '校验失败',
  );
});
