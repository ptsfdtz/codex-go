import type { Request } from '../workspace';

export const isProjectImage = (path: string) =>
  /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(path);
const imageTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/x-icon',
  'image/avif',
]);
type Chunk = {
  projectId: string;
  path: string;
  mime: string;
  sha256: string;
  totalBytes: number;
  offset: number;
  data: string;
  nextOffset: number | null;
};

export async function readProjectImage(
  request: Request,
  projectId: string,
  path: string,
  current: () => boolean,
): Promise<Blob> {
  let offset = 0,
    hash = '',
    mime = '';
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  do {
    if (!current()) throw new Error('图片读取已取消');
    const chunk = await request<Chunk>('files.readImage', {
      projectId,
      path,
      offset,
      ...(hash ? { sha256: hash } : {}),
    });
    if (!current()) throw new Error('图片读取已取消');
    if (
      chunk.projectId !== projectId ||
      chunk.path !== path ||
      chunk.offset !== offset ||
      !Number.isSafeInteger(chunk.totalBytes) ||
      chunk.totalBytes < 1 ||
      chunk.totalBytes > 8 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(chunk.sha256) ||
      !imageTypes.has(chunk.mime) ||
      (hash && (chunk.sha256 !== hash || chunk.mime !== mime || chunk.totalBytes !== bytes?.length))
    )
      throw new Error('图片资源描述无效');
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
      throw new Error('图片分块无效');
    bytes.set(data, offset);
    offset = next;
  } while (offset < bytes.length);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  if (digest !== hash) throw new Error('图片校验失败，请刷新');
  return new Blob([bytes], { type: mime });
}
