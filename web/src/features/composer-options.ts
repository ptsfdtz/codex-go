import type { Draft } from '../workspace';
export function resources(draft: Draft) {
  return {
    ...(draft.references?.length
      ? { references: draft.references.map(({ projectId, path }) => ({ projectId, path })) }
      : {}),
    ...(draft.attachments.length
      ? { attachments: draft.attachments.map(({ name, data }) => ({ name, data })) }
      : {}),
    ...(draft.skills.length ? { skills: draft.skills.map((skill) => skill.id) } : {}),
  };
}

export function turnOptions(draft: Draft, permissionMode: string, supportsResponseSpeed: boolean) {
  return {
    text: draft.text.trim(),
    mode: draft.mode,
    permissionMode,
    ...(draft.model ? { model: draft.model } : {}),
    ...(draft.effort ? { effort: draft.effort } : {}),
    ...(supportsResponseSpeed && draft.responseSpeed ? { responseSpeed: draft.responseSpeed } : {}),
    ...resources(draft),
  };
}
