import { MotionPresence } from '../motion';
import { useEffect, useState } from 'react';
import { Target, CircleGauge } from 'lucide-react';
import { Modal, DataFields } from '../ui';
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
          <span>Context {percent !== undefined ? `${percent}%` : '—'}</span>
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
          <Modal title="用量" onClose={() => setDetail(false)}>
            {counters ? (
              <>
                <p className="muted">来自上游的观测值，不是费用估算。</p>
                <DataFields
                  value={{
                    context: percent !== undefined ? `${percent}%` : '未报告',
                    modelContextWindow: counters.modelContextWindow,
                    last: counters.last,
                    total: counters.total,
                  }}
                />
              </>
            ) : (
              <p className="muted">暂无上游用量数据。</p>
            )}
          </Modal>
        )}
      </MotionPresence>
    </>
  );
}
