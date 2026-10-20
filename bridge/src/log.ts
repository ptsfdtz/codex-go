const patterns = [
  /\bsk-[A-Za-z0-9_\-.*]{8,}/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /((?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|credential|secret)\s*["']?\s*[:=]\s*["']?)([^\s,"'}]+)/gi,
  /Bearer\s+[A-Za-z0-9._~-]+/gi,
];
export function redact(value: string): string {
  for (const pattern of patterns)
    value = value.replace(pattern, (_match, prefix: unknown) =>
      typeof prefix === 'string' ? `${prefix}[REDACTED]` : '[REDACTED]',
    );
  return value;
}
export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /^(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|credential|secret)$/i.test(
          key,
        )
          ? '[REDACTED]'
          : redactValue(entry),
      ]),
    );
  return value;
}
export function log(event: string, details: Record<string, unknown> = {}): void {
  process.stderr.write(
    JSON.stringify(redactValue({ ts: new Date().toISOString(), event, ...details })) + '\n',
  );
}
