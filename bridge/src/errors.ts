export class DeckError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}
export function invariant(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new DeckError(code, message);
}
export function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
