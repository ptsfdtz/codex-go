import { expect, it } from 'vitest';
import { confirmedAnswers, messageQuestions, replyText } from './question-replies';
const entry = {
  turnId: 'turn',
  item: {
    id: 'question-item',
    type: 'agentMessage',
    questions: [
      { title: 'Season?', options: ['Spring', 'Autumn'] },
      { title: 'Colour?', options: ['Blue'] },
    ],
  },
};
it('replies to the exact native async question identity and supports partial answers', () => {
  expect(messageQuestions(entry)).toHaveLength(2);
  const text = replyText(entry, { '1': 'Blue' });
  expect(text).toContain(
    JSON.stringify({
      questionItemId: JSON.stringify(['request_user_input_async', 'question-item', 1]),
      question: 'Colour?',
      answer: 'Blue',
    }),
  );
  const history = [
    {
      turnId: 'reply',
      item: { id: 'reply-item', type: 'userMessage', content: [{ type: 'text', text }] },
    },
  ];
  expect([...confirmedAnswers(history, 'question-item')]).toEqual(['1']);
  expect([...confirmedAnswers(history, 'other-item')]).toEqual([]);
  expect([
    ...confirmedAnswers(
      [{ ...history[0], item: { ...history[0]!.item, type: 'agentMessage' } }],
      'question-item',
    ),
  ]).toEqual([]);
  expect(() => replyText(entry, {})).toThrow('填写回答');
  expect(() => replyText(entry, { '0': 'x'.repeat(64000) })).toThrow('64000');
});
