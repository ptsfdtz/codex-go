import { expect, it } from 'vitest';
import { readAttachments, turnOptions } from './composer-input';
import { emptyDraft } from '../workspace';
it('enforces decoded attachment limits before reading files and preserves exact bytes', async () => {
  const files = Array.from({ length: 5 }, (_, i) => new File(['a'], `${i}.txt`));
  await expect(readAttachments(files, [])).rejects.toThrow('4');
  await expect(readAttachments([new File([new Uint8Array(524289)], 'large')], [])).rejects.toThrow(
    '512',
  );
  await expect(readAttachments([new File(['x'], '../outside')], [])).rejects.toThrow('文件名');
  const result = await readAttachments(
    [new File(['你好'], 'note.txt', { type: 'text/plain' })],
    [],
  );
  expect(result[0]?.bytes).toBe(6);
  expect(result[0]?.data).toBe('5L2g5aW9');
  const draft = {
    ...emptyDraft(),
    text: '  review  ',
    mode: 'plan',
    model: 'model',
    effort: 'high',
    attachments: result,
    skills: [{ id: 'b'.repeat(64), name: 'review', enabled: true }],
  };
  expect(turnOptions(draft, 'workspace')).toEqual({
    text: 'review',
    mode: 'plan',
    model: 'model',
    effort: 'high',
    permissionMode: 'workspace',
    attachments: [{ name: 'note.txt', data: '5L2g5aW9' }],
    skills: ['b'.repeat(64)],
  });
});
