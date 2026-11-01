import { t, useLocale } from '../i18n';
import type { HistoryEntry } from '../history';
import { MotionPresence } from '../motion';

export function TaskProgress({
  entries,
  active,
  stale = false,
  turnId,
}: {
  entries: HistoryEntry[];
  active: boolean;
  stale?: boolean;
  turnId?: string;
}) {
  useLocale();
  const latest = [...entries].reverse().filter((entry) => entry.turnId === turnId);
  const current = latest.find((entry) => entry.item?.status === 'inProgress');
  const item = current?.item;
  const label =
    (
      {
        commandExecution: t('正在执行命令'),
        fileChange: t('正在修改文件'),
        webSearch: t('正在检索'),
        mcpToolCall: t('正在调用工具'),
        reasoning: t('正在思考'),
        plan: t('正在整理计划'),
        agentMessage: t('正在生成回复'),
      } as Record<string, string>
    )[String(item?.type)] || t('任务正在执行');
  const plan = latest.find((entry) => entry.item?.type === 'plan' && Array.isArray(entry.item.plan))
    ?.item?.plan as { status?: string }[] | undefined;
  return (
    <MotionPresence>
      {active && (
        <div className="task-progress" role="status">
          <span className="dot online" />
          <span>
            {stale ? t('上次进度 · ') : ''}
            {label}
          </span>
          {plan?.length ? (
            <span className="muted">
              {t('plan.progress', {
                done: plan.filter((step) => step.status === 'completed').length,
                total: plan.length,
              })}
            </span>
          ) : null}
        </div>
      )}
    </MotionPresence>
  );
}
