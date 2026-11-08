import { contentText } from '../../content-text';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === 'string' ? value : '');

// Only native read actions identify a skill. Mentioning SKILL.md in a shell
// command or an assistant message is not evidence that a skill was read.
export function toolPresentation(item: Record<string, unknown>) {
  const reads = Array.isArray(item.commandActions) ? item.commandActions.map(object) : [];
  const skill = reads.find(
    (action) => action.type === 'read' && /(?:^|[\\/])SKILL\.md$/i.test(text(action.path)),
  );
  const app = object(item.appContext);
  const kind = skill
    ? 'skill'
    : item.type === 'mcpToolCall'
      ? text(item.pluginId) || text(app.appName)
        ? 'plugin'
        : 'mcp'
      : item.type === 'dynamicToolCall'
        ? 'tool'
        : undefined;
  const path = text(skill?.path).replace(/\\/g, '/');
  const name = skill
    ? path.split('/').at(-2) || 'SKILL.md'
    : [
        text(app.appName) || text(item.pluginId) || text(item.server) || text(item.namespace),
        text(app.actionName) || text(item.tool),
      ]
        .filter(Boolean)
        .join(' · ');
  const result = object(item.result);
  const failed =
    item.status === 'failed' ||
    item.status === 'declined' ||
    item.success === false ||
    !!item.error ||
    result.isError === true ||
    (typeof item.exitCode === 'number' && item.exitCode !== 0);
  const status = failed
    ? 'failed'
    : item.status === 'inProgress'
      ? 'running'
      : item.status === 'completed'
        ? 'completed'
        : 'unknown';
  const blocks = Array.isArray(result.content)
    ? result.content
    : Array.isArray(item.contentItems)
      ? item.contentItems
      : [];
  const output = blocks
    .map((value) => {
      const block = object(value);
      return contentText(block) || text(object(block.resource).text);
    })
    .filter(Boolean)
    .join('\n\n');
  const media = blocks
    .map(object)
    .filter((block) =>
      ['image', 'audio', 'inputImage', 'inputAudio'].includes(text(block.type)),
    ).length;
  const error = typeof item.error === 'string' ? item.error : text(object(item.error).message);
  return {
    kind,
    name,
    status,
    output,
    media,
    error,
    progress: text(item.output),
    structured: result.structuredContent,
  };
}
