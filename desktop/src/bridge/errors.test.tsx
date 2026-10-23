import { describe, expect, it } from 'vitest';
import { errorText, presentDesktopError } from './errors';

describe('service startup failures', () => {
  it('classifies rejected requests while hiding diagnostics', () => {
    const error = presentDesktopError(null, 'SYNC_CONFLICT: private-path');
    expect(error.title).toBe('会话同步尚未完成');
    expect(errorText(error)).not.toContain('private-path');
  });
  it('explains why retrying a low integrity binary in another terminal cannot fix startup', () => {
    const error = presentDesktopError('LOW_INTEGRITY_HOST', 'private diagnostic');
    expect(error.title).toContain('低完整性');
    expect(error.solution).toContain('解压');
    expect(error.retry).toBe(false);
    expect(errorText(error)).not.toContain('private diagnostic');
  });
  it.each([
    'IO_ERROR',
    'SYNC_CONFLICT',
    'SYNC_LIMIT',
    'THREAD_SYNC_FAILED',
    'DATA_DIRECTORY_ERROR',
    'CONFLICT',
    'PORT_UNAVAILABLE',
    'DATABASE_ERROR',
    'SECRET_STORE_ERROR',
    'SANDBOX_UNVERIFIED',
    'SANDBOX_EXECUTOR_UNAVAILABLE',
  ])('gives actionable help for %s without exposing raw diagnostics', (code) => {
    const error = presentDesktopError(code, 'private-path credential=do-not-display');
    expect(error.title).not.toBe('操作未完成');
    expect(error.solution).toBeTruthy();
    expect(error.retry).toBe(true);
    expect(errorText(error)).not.toContain('do-not-display');
    expect(errorText(error)).not.toContain('private-path');
  });
});
