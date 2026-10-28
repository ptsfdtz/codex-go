import type { Attachment, Draft } from '../workspace';
import { compressAttachment, MAX_ATTACHMENT_BYTES } from './attachment-compression';

export async function readAttachments(
  files: File[],
  existing: Attachment[],
  totalLimit = 4 * MAX_ATTACHMENT_BYTES,
): Promise<Attachment[]> {
  if (existing.length + files.length > 4) throw new Error('最多添加 4 个附件');
  const added: Attachment[] = [];
  for (const original of files) {
    let file = original;
    if (!file.size || /[\\/]/.test(file.name) || [...file.name].some((c) => c.charCodeAt(0) < 32))
      throw new Error('附件文件名或内容无效');
    file = await compressAttachment(file);
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
  if ([...existing, ...added].some((file) => file.bytes > MAX_ATTACHMENT_BYTES))
    throw new Error('单文件最大 512 KiB，请移除超限附件后重新添加');
  if ([...existing, ...added].reduce((sum, file) => sum + file.bytes, 0) > totalLimit)
    throw new Error('当前 Host 仍限制附件合计大小，请升级 Host 后发送多个附件');
  return [...existing, ...added];
}
export function resources(draft: Draft) {
  return {
    ...(draft.attachments.length
      ? { attachments: draft.attachments.map(({ name, data }) => ({ name, data })) }
      : {}),
    ...(draft.skills.length ? { skills: draft.skills.map((skill) => skill.id) } : {}),
  };
}
export function turnOptions(draft: Draft, permissionMode: string) {
  return {
    text: draft.text.trim(),
    mode: draft.mode,
    permissionMode,
    ...(draft.model ? { model: draft.model } : {}),
    ...(draft.effort ? { effort: draft.effort } : {}),
    ...resources(draft),
  };
}
