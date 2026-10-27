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
          <span>上下文 {percent !== undefined ? `${percent}%` : '—'}</span>
          <span>·</span>
          <span>{counters?.total?.totalTokens?.toLocaleString() || '—'} tokens</span>
        </button>
      )}
      {goal && (
        <button className="goal-composer" onClick={onGoal}>
          <Target size={15} />
          <span>
            {(
              {
                active: 'Working',
                paused: 'Paused',
                blocked: 'Blocked',
                complete: 'Completed',
                usageLimited: 'Usage limit',
                budgetLimited: 'Budget limit',
              } as Record<string, string>
            )[goal.status] || goal.status}
          </span>
          <span className="goal-composer-objective">{goal.objective}</span>
          {goal.timeUsedSeconds !== undefined && (
            <small>
              {Math.floor(goal.timeUsedSeconds / 60)}m {goal.timeUsedSeconds % 60}s
            </small>
          )}
        </button>
      )}
      {error && (
        <button className="context-usage error" onClick={onGoal}>
          Goal · 未更新
        </button>
      )}
      <MotionPresence>
        {detail && (
          <Modal title="用量" className="usage-modal" onClose={() => setDetail(false)}>
            {counters ? (
              <div className="usage-detail">
                <section className="usage-context" aria-label="上下文用量">
                  <div className="usage-context-heading">
                    <span>上下文已使用</span>
                    <strong>{percent !== undefined ? `${percent}%` : '—'}</strong>
                  </div>
                  <progress aria-label="上下文已使用" max={100} value={percent ?? 0} />
                  <small>
                    {used?.toLocaleString() ?? '—'} / {window?.toLocaleString() ?? '—'} tokens
                  </small>
                </section>
                <table className="usage-table">
                  <caption>Token 用量</caption>
                  <thead>
                    <tr>
                      <th scope="col">用量</th>
                      <th scope="col">最近一次</th>
                      <th scope="col">会话累计</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        ['totalTokens', '总计'],
                        ['inputTokens', '输入'],
                        ['outputTokens', '输出'],
                        ['cachedInputTokens', '缓存输入'],
                        ['reasoningOutputTokens', '推理输出'],
                        ...(counters.last?.cacheWriteInputTokens ||
                        counters.total?.cacheWriteInputTokens
                          ? [['cacheWriteInputTokens', '缓存写入']]
                          : []),
                      ] as [string, string][]
                    ).map(([key, label]) => (
                      <tr key={key}>
                        <th scope="row">{label}</th>
                        <td>{counters.last?.[key]?.toLocaleString() ?? '—'}</td>
                        <td>{counters.total?.[key]?.toLocaleString() ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">暂无用量数据</p>
            )}
          </Modal>
        )}
      </MotionPresence>
    </>
  );
}
