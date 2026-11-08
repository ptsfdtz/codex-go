import { t, useLocale } from '../i18n';
import type { HistoryEntry } from '../history';

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
  if (!active) return null;
  const description = `${stale ? t('上次进度 · ') : ''}${label}${plan?.length ? ` · ${t('plan.progress', { done: plan.filter((step) => step.status === 'completed').length, total: plan.length })}` : ''}`;
  return (
    <span
      className="task-running-indicator"
      data-stale={stale || undefined}
      role="status"
      aria-label={description}
      title={description}
    />
  );
}
