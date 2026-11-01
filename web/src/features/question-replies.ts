import { t } from '../i18n';
import type { HistoryEntry } from '../history';
import { contentText } from '../content-text';
export type Question = {
  id: string;
  title: string;
  header?: string;
  options: { label: string; description?: string }[];
  secret?: boolean;
};
export function messageQuestions(entry: HistoryEntry): Question[] {
  if (
    !['agentMessage', 'assistantMessage'].includes(String(entry.item?.type)) ||
    !Array.isArray(entry.item?.questions)
  )
    return [];
  return entry.item.questions.flatMap((q, index) =>
    typeof q?.title === 'string'
      ? [
          {
            id: String(index),
            title: q.title,
            options: Array.isArray(q.options)
              ? q.options.flatMap((o: unknown) => (typeof o === 'string' ? [{ label: o }] : []))
              : [],
          },
        ]
      : [],
  );
}
export function replyText(entry: HistoryEntry, answers: Record<string, string>) {
  if (!entry.item?.id) throw new Error(t('问题身份缺失，请刷新会话'));
  const responses = messageQuestions(entry).flatMap((q) =>
    answers[q.id]?.trim()
      ? [
          {
            questionItemId: JSON.stringify([
              'request_user_input_async',
              entry.item!.id,
              Number(q.id),
            ]),
            question: q.title,
            answer: answers[q.id],
          },
        ]
      : [],
  );
  if (!responses.length) throw new Error(t('请填写回答'));
  const text = `<send_user_message_question_reply>\n${JSON.stringify(responses)}\n</send_user_message_question_reply>`;
  if (text.length > 64000) throw new Error(t('回答合计不能超过 64000 字符'));
  return text;
}
export function confirmedAnswers(history: HistoryEntry[], itemId: string) {
  const ids = new Set<string>();
  for (const entry of history) {
    if (entry.item?.type !== 'userMessage') continue;
    const text = contentText(entry.item).trim();
    const match =
      /^<send_user_message_question_reply>\s*([\s\S]+?)\s*<\/send_user_message_question_reply>$/.exec(
        text,
      );
    if (!match) continue;
    try {
      const rows: unknown = JSON.parse(match[1]!);
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const key = JSON.parse(row.questionItemId);
        if (
          key.length === 3 &&
          key[0] === 'request_user_input_async' &&
          key[1] === itemId &&
          Number.isInteger(key[2]) &&
          typeof row.answer === 'string' &&
          row.answer.trim()
        )
          ids.add(String(key[2]));
      }
    } catch {
      /* Only positive native history evidence counts. */
    }
  }
  return ids;
}
