import { expect, it } from 'vitest';
import { historyKey, mergeHistory, withLiveText, type HistoryEntry } from './history';
const entry = (id: string, text = id, turn = 'turn'): HistoryEntry => ({
  turnId: turn,
  item: { id, text, type: 'agentMessage' },
});
it('keeps older pages across live refresh and deduplicates overlapping pages', () => {
  let items = mergeHistory([entry('b'), entry('c')], [entry('a'), entry('b')], 'older');
  items = mergeHistory(items, [entry('c', 'streaming'), entry('d')], 'latest');
  expect(items.map((item) => item.item?.id)).toEqual(['a', 'b', 'c', 'd']);
  expect(items[2]?.item?.text).toBe('streaming');
});
it('does not overwrite a current item with an older request that finishes late', () => {
  const items = mergeHistory(
    [entry('b', 'finished')],
    [entry('a'), entry('b', 'partial')],
    'older',
  );
  expect(items[1]?.item?.text).toBe('finished');
  expect(historyKey(entry('b', '', 'other'))).not.toBe(historyKey(entry('b')));
});
it('merges persisted output and native live output into one item without regression', () => {
  const live = entry('answer', 'hello world');
  const streams = new Map([[historyKey(live), live]]);
  expect(withLiveText([entry('answer', 'hello')], streams)).toEqual([live]);
  expect(withLiveText([entry('answer', 'hello world!')], streams)[0]?.item?.text).toBe(
    'hello world!',
  );
});
