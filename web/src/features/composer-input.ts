import type { Attachment, Draft } from '../workspace';

export async function readAttachments(
  files: File[],
  existing: Attachment[],
): Promise<Attachment[]> {
  if (existing.length + files.length > 4) throw new Error('最多添加 4 个附件');
  if (existing.reduce((n, f) => n + f.bytes, 0) + files.reduce((n, f) => n + f.size, 0) > 524288)
    throw new Error('附件合计不能超过 512 KiB');
  const added = await Promise.all(
    files.map(async (file) => {
      if (!file.size || /[\\/]/.test(file.name) || [...file.name].some((c) => c.charCodeAt(0) < 32))
        throw new Error('附件文件名或内容无效');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return { name: file.name, bytes: file.size, mime: file.type, data: btoa(binary) };
    }),
  );
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
