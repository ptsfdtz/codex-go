import { expect, it } from 'vitest';
import { applyProgress, historyError, mergeHistorySnapshot } from './conversation';
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
    item: { id: 'answer', status: 'inProgress', type: 'agentMessage', text: '你好' },
  });
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
it('projects command and indexed reasoning deltas without fetching the history again', () => {
  const command = applyProgress(
    [],
    progress('item/commandExecution/outputDelta', { itemId: 'command', delta: 'test output' }),
  );
  expect(command[0]?.item).toMatchObject({
    type: 'commandExecution',
    aggregatedOutput: 'test output',
  });
  let reasoning = applyProgress(
    command,
    progress('item/reasoning/summaryTextDelta', {
      itemId: 'reasoning',
      summaryIndex: 0,
      delta: 'first',
    }),
  );
  reasoning = applyProgress(
    reasoning,
    progress('item/reasoning/summaryTextDelta', {
      itemId: 'reasoning',
      summaryIndex: 1,
      delta: 'second',
    }),
  );
  expect(reasoning[1]?.item?.summary).toEqual(['first', 'second']);
  reasoning = applyProgress(
    reasoning,
    progress('item/reasoning/summaryTextDelta', {
      itemId: 'reasoning',
      summaryIndex: 0,
      delta: ' continued',
    }),
  );
  expect(reasoning[1]?.item?.summary).toEqual(['first continued', 'second']);
  expect(reasoning[0]?.item?.aggregatedOutput).toBe('test output');
});
it('keeps an authoritative final item even when it is shorter and late deltas arrive', () => {
  const partial = applyProgress([], progress('item/agentMessage/delta', { delta: 'draft draft' }));
  const final = applyProgress(
    partial,
    progress('item/completed', { item: { id: 'answer', type: 'agentMessage', text: 'final' } }),
  );
  expect(applyProgress(final, progress('item/agentMessage/delta'))).toBe(final);
  expect(final[0]?.item?.text).toBe('final');
});
it('retains the authoritative failure status of a completed tool', () => {
  const final = applyProgress(
    [],
    progress('item/completed', {
      item: { id: 'answer', type: 'commandExecution', status: 'failed', exitCode: 1 },
    }),
  );
  expect(final[0]?.item?.status).toBe('failed');
  expect(applyProgress(final, progress('item/commandExecution/outputDelta'))).toBe(final);
});
it('preserves separate native turns even when item IDs repeat', () => {
  const first = applyProgress([], progress('item/agentMessage/delta'));
  expect(
    applyProgress(first, progress('item/agentMessage/delta', { turnId: 'another-turn' })),
  ).toHaveLength(2);
});
it('does not let a delayed history read overwrite a newer completion', () => {
  const before = applyProgress([], progress('item/agentMessage/delta', { delta: 'draft' }));
  const final = applyProgress(
    before,
    progress('item/completed', {
      item: { id: 'answer', type: 'agentMessage', text: 'done' },
    }),
  );
  expect(mergeHistorySnapshot(final, before, before)[0]?.item?.text).toBe('done');
  expect(mergeHistorySnapshot(before, final, before)[0]?.item?.text).toBe('done');
});
it('explains authorization failures without suggesting a successful empty conversation', () => {
  expect(historyError(new Error('WORKSPACE_FORBIDDEN: changed'))).toContain('核对目录');
  expect(historyError(new Error('network timeout'))).toContain('network timeout');
});
