import { t } from './i18n';
import type { Bridge } from './transport/bridge';

export function imageMime(bytes: Uint8Array): string | undefined {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const header = new TextDecoder().decode(bytes.slice(0, 12));
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) return 'image/gif';
  if (header.startsWith('RIFF') && header.slice(8) === 'WEBP') return 'image/webp';
}
type ImageChunk = {
  sessionId: string;
  turnId: string;
  itemId: string;
  contentIndex: number;
  sha256: string;
  mime: string;
  totalBytes: number;
  offset: number;
  data: string;
  nextOffset: number | null;
};
export async function readHistoryImage(
  connection: Bridge,
  sessionId: string,
  turnId: string,
  itemId: string,
  contentIndex: number,
  current: () => boolean,
  sourcePath?: string,
): Promise<Blob> {
  let offset = 0,
    hash = '',
    mime = '',
    bytes: Uint8Array<ArrayBuffer> | undefined;
  do {
    if (!current()) throw new Error(t('图片读取已取消'));
    const chunk = await connection.request<ImageChunk>('sessions.image', {
      sessionId,
      turnId,
      itemId,
      contentIndex,
      ...(sourcePath ? { sourcePath } : {}),
      offset,
      ...(hash ? { sha256: hash } : {}),
    });
    if (!current()) throw new Error(t('图片读取已取消'));
    if (
      chunk.sessionId !== sessionId ||
      chunk.turnId !== turnId ||
      chunk.itemId !== itemId ||
      chunk.contentIndex !== contentIndex ||
      chunk.offset !== offset ||
      !Number.isSafeInteger(chunk.totalBytes) ||
      chunk.totalBytes < 1 ||
      chunk.totalBytes > 8 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(chunk.sha256) ||
      !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(chunk.mime) ||
      (hash && (chunk.sha256 !== hash || chunk.mime !== mime || chunk.totalBytes !== bytes?.length))
    )
      throw new Error(t('历史图片资源描述无效'));
    if (!bytes) {
      bytes = new Uint8Array(chunk.totalBytes);
      hash = chunk.sha256;
      mime = chunk.mime;
    }
    const data = Uint8Array.from(atob(chunk.data), (c) => c.charCodeAt(0));
    const next = offset + data.length;
    if (
      !data.length ||
      data.length > 64 * 1024 ||
      next > bytes.length ||
      chunk.nextOffset !== (next === bytes.length ? null : next)
    )
      throw new Error(t('历史图片分块无效'));
    bytes.set(data, offset);
    offset = next;
  } while (offset < bytes.length);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  if (digest !== hash || imageMime(bytes) !== mime) throw new Error(t('历史图片校验失败'));
  return new Blob([bytes], { type: mime });
}
