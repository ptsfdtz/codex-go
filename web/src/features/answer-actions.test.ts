import { expect, it } from 'vitest';
import { answerActions } from './answer-actions';
import type { HistoryEntry } from '../history';

it('shows one action group per finished answer and combines only assistant text', () => {
  const entries: HistoryEntry[] = [
    { turnId: 'old', item: { type: 'agentMessage', text: 'Earlier answer' } },
    { turnId: 'new', item: { type: 'userMessage', text: 'Question' } },
    { turnId: 'new', item: { type: 'agentMessage', text: 'Progress' } },
    { turnId: 'new', item: { type: 'commandExecution', text: 'Tool output' } },
    { turnId: 'new', item: { role: 'assistant', text: 'Final answer' } },
  ];
  const text = (item: HistoryEntry['item']) => String(item?.text || '');
  expect([...answerActions(entries, 'new', text)]).toEqual([[entries[0], 'Earlier answer']]);
  expect([...answerActions(entries, undefined, text)]).toEqual([
    [entries[0], 'Earlier answer'],
    [entries[4], 'Progress\n\nFinal answer'],
  ]);
});
