import { expect, it } from 'vitest';
import { applyProgress, historyError } from './conversation';
import type { Packet } from './transport/bridge';

const progress = (method: string, extra = {}): Packet => ({
  type: 'event',
  action: 'turn.progress',
  turnId: 'local-turn',
  payload: { method, turnId: 'native-turn', itemId: 'answer', delta: '你好', ...extra },
});
it('keeps tool output and reasoning separate from assistant text and uses native identities', () => {
  const first = applyProgress([], progress('item/agentMessage/delta'));
  expect(first[0]).toEqual({
    turnId: 'native-turn',
    item: { id: 'answer', type: 'agentMessage', text: '你好' },
  });
  expect(applyProgress(first, progress('item/commandExecution/outputDelta'))).toBe(first);
  expect(applyProgress(first, progress('item/reasoning/textDelta'))).toBe(first);
  expect(applyProgress(first, progress('item/agentMessage/delta', { turnId: undefined }))).toBe(
    first,
  );
  const second = applyProgress(first, progress('item/agentMessage/delta', { delta: '，世界' }));
  expect(second).toHaveLength(1);
  expect(second[0]?.item?.text).toBe('你好，世界');
  const final = applyProgress(
    second,
    progress('item/completed', {
      item: { id: 'answer', type: 'agentMessage', text: '你好，世界！' },
    }),
  );
  expect(final).toHaveLength(1);
  expect(final[0]?.item?.text).toBe('你好，世界！');
});
it('preserves separate native turns even when item IDs repeat', () => {
  const first = applyProgress([], progress('item/agentMessage/delta'));
  expect(
    applyProgress(first, progress('item/agentMessage/delta', { turnId: 'another-turn' })),
  ).toHaveLength(2);
});
it('explains authorization failures without suggesting a successful empty conversation', () => {
  expect(historyError(new Error('WORKSPACE_FORBIDDEN: changed'))).toContain('核对目录');
  expect(historyError(new Error('network timeout'))).toContain('network timeout');
});
