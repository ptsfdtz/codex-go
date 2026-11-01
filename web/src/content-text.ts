export function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  const object = value as Record<string, unknown>;
  if (fileReferencePart(object)) return '';
  for (const key of [
    'text',
    'content',
    'message',
    'summary',
    'aggregatedOutput',
    'output',
    'review',
  ])
    if (typeof object[key] === 'string' || Array.isArray(object[key])) {
      const result = contentText(object[key]);
      if (result) return result;
    }
  return '';
}

export function fileReferencePart(value: unknown): { name: string; path: string } | undefined {
  if (!value || typeof value !== 'object') return;
  const part = value as {
    type?: string;
    text?: string;
    text_elements?: { byteRange?: { start?: number; end?: number }; placeholder?: string }[];
  };
  const text = part.text;
  if (part.type !== 'text' || typeof text !== 'string' || !/^(?:\/|[A-Za-z]:[\\/])/.test(text))
    return;
  const elements = part.text_elements;
  const name = elements?.[0]?.placeholder?.startsWith('@') ? elements[0].placeholder.slice(1) : '';
  if (
    name &&
    Array.isArray(elements) &&
    elements.length === 1 &&
    elements[0]?.byteRange?.start === 0 &&
    elements[0]?.byteRange?.end === new TextEncoder().encode(text).length
  )
    return { name, path: text };
}
