import type { Bridge } from './transport/bridge';

export type Attachment = { name: string; data: string; mime: string; bytes: number };
export const MAX_ATTACHMENTS = 512 * 1024;

export function imageMime(bytes: Uint8Array): string | undefined {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const header = new TextDecoder().decode(bytes.slice(0, 12));
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) return 'image/gif';
  if (header.startsWith('RIFF') && header.slice(8) === 'WEBP') return 'image/webp';
}
export async function attachmentsFromFiles(
  files: File[],
  current: Attachment[],
): Promise<Attachment[]> {
  if (
    files.length + current.length > 4 ||
    files.reduce(
      (n, f) => n + f.size,
      current.reduce((n, f) => n + f.bytes, 0),
    ) > MAX_ATTACHMENTS
  )
    throw new Error('最多选择 4 张图片，图片总大小不能超过 512 KiB');
  const additions: Attachment[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = imageMime(bytes);
    if (!mime) throw new Error('仅支持 PNG、JPEG、GIF 和 WebP 图片');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    additions.push({
      name: `image-${crypto.randomUUID()}.${mime.split('/')[1]}`,
      data: btoa(binary),
      mime,
      bytes: bytes.length,
    });
  }
  return [...current, ...additions];
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
): Promise<Blob> {
  let offset = 0,
    hash = '',
    mime = '',
    bytes: Uint8Array<ArrayBuffer> | undefined;
  do {
    if (!current()) throw new Error('图片读取已取消');
    const chunk = await connection.request<ImageChunk>('sessions.image', {
      sessionId,
      turnId,
      itemId,
      contentIndex,
      offset,
      ...(hash ? { sha256: hash } : {}),
    });
    if (!current()) throw new Error('图片读取已取消');
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
      throw new Error('历史图片资源描述无效');
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
      throw new Error('历史图片分块无效');
    bytes.set(data, offset);
    offset = next;
  } while (offset < bytes.length);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  if (digest !== hash || imageMime(bytes) !== mime) throw new Error('历史图片校验失败');
  return new Blob([bytes], { type: mime });
}
