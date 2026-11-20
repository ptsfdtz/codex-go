export { resources, turnOptions } from './composer-options';
import { t } from '../i18n';
import type { Attachment } from '../workspace';
import {
  compressAttachment,
  LEGACY_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TOTAL,
  sizeLabel,
} from './attachment-compression';

export async function readAttachments(
  files: File[],
  existing: Attachment[],
  totalLimit = MAX_ATTACHMENT_TOTAL,
  fileLimit = LEGACY_ATTACHMENT_BYTES,
  countLimit = 4,
): Promise<Attachment[]> {
  const maxTotal = Math.min(MAX_ATTACHMENT_TOTAL, totalLimit);
  const maxFile = Math.min(maxTotal, fileLimit);
  const maxCount = Math.min(4, countLimit);
  if (![maxTotal, maxFile, maxCount].every((n) => Number.isSafeInteger(n) && n > 0))
    throw new Error(t('电脑返回了无效的附件限额'));
  if (existing.length + files.length > maxCount)
    throw new Error(t('最多添加 {{count}} 个附件', { count: maxCount }));
  if (existing.some((file) => file.bytes > maxFile))
    throw new Error(t('已有附件超过当前电脑的单文件限制'));
  let total = existing.reduce((sum, file) => sum + file.bytes, 0);
  const added: Attachment[] = [];
  for (const original of files) {
    let file = original;
    if (!file.size || /[\\/]/.test(file.name) || [...file.name].some((c) => c.charCodeAt(0) < 32))
      throw new Error(t('附件文件名或内容无效'));
    file = await compressAttachment(file, maxFile);
    total += file.size;
    if (total > maxTotal)
      throw new Error(
        t('附件合计最多 {{limit}}，请减少附件后重试', { limit: sizeLabel(maxTotal) }),
      );
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    added.push({
      name: file.name,
      bytes: file.size,
      mime: file.type,
      data: btoa(binary),
      ...(file !== original ? { originalBytes: original.size } : {}),
    });
  }
  return [...existing, ...added];
}
