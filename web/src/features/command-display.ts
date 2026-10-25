// Presentation only. Keep the original command available; never execute or
// rewrite history while removing recognizable shell launch boilerplate.
function payloadText(value: string): string | undefined {
  if (!/^['"]/.test(value)) return value;
  let quote = '',
    result = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (!quote) {
      if (c === "'" || c === '"') quote = c;
      else if (/\s/.test(c)) return;
      else if (c === '\\' && i + 1 < value.length) result += value[++i];
      else result += c;
    } else if (c === quote) quote = '';
    else if (quote === '"' && c === '\\' && /["\\$`\n]/.test(value[i + 1] || '')) {
      const next = value[++i]!;
      if (next !== '\n') result += next;
    } else result += c;
  }
  return quote ? undefined : result;
}

export function displayCommand(command: string): string {
  let value = command.trim();
  for (let depth = 0; depth < 4; depth++) {
    const executable = /^(?:&\s+)?(?:"([^"]+)"|'([^']+)'|([^\s"']+))\s+([\s\S]+)$/.exec(value);
    if (!executable) break;
    const name = (executable[1] || executable[2] || executable[3] || '')
      .split(/[\\/]/)
      .pop()!
      .toLowerCase();
    const args = executable[4]!;
    let match: RegExpExecArray | null = null;
    if (/^(?:powershell|pwsh)(?:\.exe)?$/.test(name))
      match =
        /^(?:(?:-(?:noprofile|noninteractive|nologo|nol|nop)\s+)|(?:-executionpolicy\s+(?:bypass|remotesigned|restricted|allsigned|unrestricted|default)\s+)|(?:-windowstyle\s+(?:hidden|normal|minimized|maximized)\s+))*(?:-command|-c)\s+([\s\S]+)$/i.exec(
          args,
        );
    else if (/^(?:ba|da|z|k)?sh(?:\.exe)?$/.test(name))
      match = /^(?:-(?:l|login)\s+)?-(?:c|lc|cl)\s+([\s\S]+)$/.exec(args);
    else if (/^cmd(?:\.exe)?$/.test(name))
      match = /^(?:\/(?:d|s|q)\s+)*\/c\s+([\s\S]+)$/i.exec(args);
    if (!match) break;
    const body = payloadText(match[1]!.trim());
    if (!body?.trim()) break;
    value = body;
  }
  return value;
}
