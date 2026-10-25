import { expect, it } from 'vitest';
import { contentText, questionAnswers } from './RichContent';

it('reads reasoning summaries even when the upstream content array is empty', () => {
  expect(contentText({ content: [], summary: ['可公开的思考摘要'] })).toBe('可公开的思考摘要');
  expect(contentText({ content: [], summary: [] })).toBe('');
});
it('renders structured question replies as question and answer while preserving malformed input', () => {
  const body =
    '<send_user_message_question_reply>\n[{"question":"哪个季节？","answer":"秋天","questionItemId":"private-native-id"}]\n</send_user_message_question_reply>';
  expect(questionAnswers(body)).toEqual([{ question: '哪个季节？', answer: '秋天' }]);
  expect(
    questionAnswers('<send_user_message_question_reply>invalid</send_user_message_question_reply>'),
  ).toBeUndefined();
  expect(questionAnswers('ordinary user message')).toBeUndefined();
});
