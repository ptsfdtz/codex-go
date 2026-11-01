import { t } from '../i18n';
export const MAX_ATTACHMENT_BYTES = 512 * 1024;

/** Re-encode oversized still images; ordinary files and animations retain their format. */
export async function compressAttachment(file: File): Promise<File> {
  if (file.size <= MAX_ATTACHMENT_BYTES) return file;
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/bmp'].includes(file.type))
    throw new Error(
      t('{{p0}}：单文件最大 512 KiB，仅支持自动压缩 PNG、JPEG、WebP、BMP 静态图片', {
        p0: file.name,
      }),
    );
  if (file.size > 64 * 1024 * 1024)
    throw new Error(t('{{p0}}：图片过大，请先在本地缩小后上传', { p0: file.name }));
  if (file.type === 'image/png') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer);
    for (let offset = 8; offset + 12 <= bytes.length; ) {
      const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (kind === 'acTL')
        throw new Error(t('{{p0}}：动态 PNG 超过 512 KiB，请先在本地压缩', { p0: file.name }));
      if (kind === 'IDAT') break;
      offset += view.getUint32(offset) + 12;
    }
  }
  // Animated WebP must not be silently converted into a still image.
  const header = new Uint8Array(await file.slice(0, 21).arrayBuffer());
  if (file.type === 'image/webp' && header[12] === 86 && header[15] === 88 && header[20]! & 2)
    throw new Error(t('{{p0}}：动态 WebP 超过 512 KiB，请先在本地压缩', { p0: file.name }));
  const url = URL.createObjectURL(file);
  const image = new Image();
  const canvas = document.createElement('canvas');
  try {
    image.src = url;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 40_000_000
    )
      throw new Error(t('图片尺寸过大或无效'));
    const context = canvas.getContext('2d');
    if (!context) throw new Error(t('浏览器不支持图片压缩'));
    let scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
    for (let attempt = 0; attempt < 12; attempt++, scale *= 0.75) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const [mime, quality] of [
        ['image/png', 1],
        ['image/webp', 0.9],
        ['image/webp', 0.75],
        ['image/webp', 0.6],
      ] as const) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, mime, quality),
        );
        if (blob && blob.size > 0 && blob.size <= MAX_ATTACHMENT_BYTES) {
          const extension = blob.type === 'image/webp' ? 'webp' : 'png';
          return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.${extension}`, {
            type: blob.type,
          });
        }
      }
    }
    throw new Error(t('无法压缩至 512 KiB，请先在本地缩小图片'));
  } catch (error) {
    throw new Error(t('{{p0}}：图片自动压缩失败（{{p1}}）', { p0: file.name, p1: String(error) }));
  } finally {
    image.src = '';
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}
