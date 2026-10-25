import { expect, it } from 'vitest';
import { projectRelativePath, turnChanges, workDuration } from './turn-changes';
it('counts successful native steps once, excludes diff headers and retains cumulative edits', () => {
  const entry = {
    turnId: 't',
    item: {
      id: 'a',
      type: 'fileChange',
      status: 'completed',
      changes: [{ path: 'a.ts', diff: '--- a/a.ts\n+++ b/a.ts\n-one\n+two' }],
    },
  };
  const second = { ...entry, item: { ...entry.item, id: 'b' } };
  const failed = { ...entry, item: { ...entry.item, id: 'c', status: 'failed' } };
  expect(turnChanges([entry, entry, second, failed])).toEqual([
    {
      path: 'a.ts',
      added: 2,
      removed: 2,
      diffs: [entry.item.changes[0]!.diff, entry.item.changes[0]!.diff],
    },
  ]);
  expect(workDuration([{ ...entry, startedAtMs: 1000, completedAtMs: 62500 }])).toBe('1m 2s');
  expect(workDuration([entry])).toBeUndefined();
});
it('maps local links only inside the exact authorized root and rejects path traversal', () => {
  expect(projectRelativePath('C:\\Work\\Project\\src\\app.ts:12:3', 'C:/Work/Project')).toBe(
    'src/app.ts',
  );
  expect(projectRelativePath('/workspace/a.ts#L9', '/workspace')).toBe('a.ts');
  expect(projectRelativePath('C:/Work/ProjectOther/secret', 'C:/Work/Project')).toBeUndefined();
  expect(projectRelativePath('/other/secret', '/workspace')).toBeUndefined();
  expect(projectRelativePath('../secret')).toBeUndefined();
  expect(projectRelativePath('%2e%2e/secret')).toBeUndefined();
  expect(projectRelativePath('javascript:alert(1)')).toBeUndefined();
});
