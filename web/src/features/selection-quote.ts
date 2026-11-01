export function appendQuote(draft: string, selection: string): string {
  const quoted = selection
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
  return `${draft}${draft && !draft.endsWith('\n\n') ? (draft.endsWith('\n') ? '\n' : '\n\n') : ''}${quoted}\n\n`;
}
