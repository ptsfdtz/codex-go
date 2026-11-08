import { ThumbsDown, ThumbsUp, createLucideIcon } from 'lucide-react';
import { t, useLocale } from '../i18n';
import { IconButton } from '../ui';
import { usePreference } from './preferences';

export const ForkAnswerIcon = createLucideIcon('ForkAnswer', [
  ['path', { d: 'M3 12h7a3 3 0 0 0 2.2-1L20 3M15 3h5v5M13.5 14.5 20 21m-5 0h5v-5', key: 'fork' }],
]);

type Reaction = '' | 'up' | 'down';

export function AnswerFeedback({ answerKey }: { answerKey: string }) {
  useLocale();
  const [reaction, setReaction] = usePreference<Reaction>(
    `agentdeck.web.answer-reaction:${answerKey}`,
    '',
    (value): value is Reaction => value === '' || value === 'up' || value === 'down',
  );
  return (
    <>
      <IconButton
        icon={ThumbsUp}
        className="answer-reaction"
        label={t('赞此回答')}
        pressed={reaction === 'up'}
        onClick={() => setReaction(reaction === 'up' ? '' : 'up')}
      />
      <IconButton
        icon={ThumbsDown}
        className="answer-reaction"
        label={t('踩此回答')}
        pressed={reaction === 'down'}
        onClick={() => setReaction(reaction === 'down' ? '' : 'down')}
      />
    </>
  );
}

export function AnswerTime({ timestamp }: { timestamp?: number }) {
  const locale = useLocale();
  if (timestamp == null) return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return (
    <time className="answer-time" dateTime={date.toISOString()}>
      {date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}
    </time>
  );
}
