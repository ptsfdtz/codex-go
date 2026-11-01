import { t, useLocale, getLocale } from '../i18n';
import { MotionPresence } from '../motion';
import { useEffect, useState } from 'react';
import { Target, CircleGauge } from 'lucide-react';
import { Modal } from '../ui';
import type { Request } from '../workspace';
type Usage = {
  last?: Record<string, number>;
  total?: Record<string, number>;
  modelContextWindow?: number;
};
export function ComposerStatus({
  request,
  sessionId,
  goalSupported,
  usageSupported,
  revision,
  observedUsage,
  onGoal,
  enabled = true,
}: {
  request: Request;
  sessionId: string;
  goalSupported: boolean;
  usageSupported: boolean;
  revision: number;
  observedUsage?: Usage;
  onGoal: () => void;
  enabled?: boolean;
}) {
  useLocale();
  const [goal, setGoal] = useState<{
      objective: string;
      status: string;
      timeUsedSeconds?: number;
    } | null>(),
    [usage, setUsage] = useState<Usage>(),
    [error, setError] = useState(''),
    [detail, setDetail] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setError('');
    if (goalSupported)
      void request<{
        goal: { objective: string; status: string; timeUsedSeconds?: number } | null;
      }>('sessions.goal', { sessionId })
        .then((v) => {
          if (current) setGoal(v.goal);
        })
        .catch((e) => {
          if (current) setError(String(e));
        });
    if (usageSupported && !observedUsage)
      void request<{ events: { action: string; payload?: { tokenUsage?: Usage } }[] }>(
        'sessions.detail',
        { sessionId, limit: 100 },
      )
        .then((v) => {
          if (current)
            setUsage(
              v.events.filter((e) => e.action === 'session.tokenUsage').at(-1)?.payload?.tokenUsage,
            );
        })
        .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [request, sessionId, goalSupported, usageSupported, revision, enabled]);
  const counters = observedUsage || usage,
    used = counters?.last?.totalTokens,
    window = counters?.modelContextWindow;
  const percent =
    used !== undefined && window ? Math.min(100, Math.round((used / window) * 100)) : undefined;
  return (
    <>
      {usageSupported && (
        <button className="context-usage" onClick={() => setDetail(true)}>
          <CircleGauge size={14} />
          <span>
            {t('上下文 ')}
            {percent !== undefined ? `${percent}%` : '—'}
          </span>
          <span>·</span>
          <span>
            {counters?.total?.totalTokens?.toLocaleString(getLocale()) || '—'} {t(' tokens')}
          </span>
        </button>
      )}
      {goal && (
        <button className="goal-composer" onClick={onGoal}>
          <Target size={15} />
          <span>
            {(
              {
                active: t('Working'),
                paused: t('Paused'),
                blocked: t('Blocked'),
                complete: t('Completed'),
                usageLimited: t('Usage limit'),
                budgetLimited: t('Budget limit'),
              } as Record<string, string>
            )[goal.status] || goal.status}
          </span>
          <span className="goal-composer-objective">{goal.objective}</span>
          {goal.timeUsedSeconds !== undefined && (
            <small>
              {t('time.minutesSeconds', {
                minutes: Math.floor(goal.timeUsedSeconds / 60),
                seconds: goal.timeUsedSeconds % 60,
              })}
            </small>
          )}
        </button>
      )}
      {error && (
        <button className="context-usage error" onClick={onGoal}>
          {t('Goal · 未更新')}
        </button>
      )}
      <MotionPresence>
        {detail && (
          <Modal title={t('用量')} className="usage-modal" onClose={() => setDetail(false)}>
            {counters ? (
              <div className="usage-detail">
                <section className="usage-context" aria-label={t('上下文用量')}>
                  <div className="usage-context-heading">
                    <span>{t('上下文已使用')}</span>
                    <strong>{percent !== undefined ? `${percent}%` : '—'}</strong>
                  </div>
                  <progress aria-label={t('上下文已使用')} max={100} value={percent ?? 0} />
                  <small>
                    {used?.toLocaleString(getLocale()) ?? '—'} /{' '}
                    {window?.toLocaleString(getLocale()) ?? '—'} {t(' tokens')}
                  </small>
                </section>
                <table className="usage-table">
                  <caption>{t('Token 用量')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('用量')}</th>
                      <th scope="col">{t('最近一次')}</th>
                      <th scope="col">{t('会话累计')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        ['totalTokens', t('总计')],
                        ['inputTokens', t('输入')],
                        ['outputTokens', t('输出')],
                        ['cachedInputTokens', t('缓存输入')],
                        ['reasoningOutputTokens', t('推理输出')],
                        ...(counters.last?.cacheWriteInputTokens ||
                        counters.total?.cacheWriteInputTokens
                          ? [['cacheWriteInputTokens', t('缓存写入')]]
                          : []),
                      ] as [string, string][]
                    ).map(([key, label]) => (
                      <tr key={key}>
                        <th scope="row">{label}</th>
                        <td>{counters.last?.[key]?.toLocaleString(getLocale()) ?? '—'}</td>
                        <td>{counters.total?.[key]?.toLocaleString(getLocale()) ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">{t('暂无用量数据')}</p>
            )}
          </Modal>
        )}
      </MotionPresence>
    </>
  );
}
