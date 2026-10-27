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
  const latest = [...entries].reverse().filter((entry) => entry.turnId === turnId);
  const current = latest.find((entry) => entry.item?.status === 'inProgress');
  const item = current?.item;
  const label =
    (
      {
        commandExecution: '正在执行命令',
        fileChange: '正在修改文件',
        webSearch: '正在检索',
        mcpToolCall: '正在调用工具',
        reasoning: '正在思考',
        plan: '正在整理计划',
        agentMessage: '正在生成回复',
      } as Record<string, string>
    )[String(item?.type)] || '任务正在执行';
  const plan = latest.find((entry) => entry.item?.type === 'plan' && Array.isArray(entry.item.plan))
    ?.item?.plan as { status?: string }[] | undefined;
  return (
    <MotionPresence>
      {active && (
        <div className="task-progress" role="status">
          <span className="dot online" />
          <span>
            {stale ? '上次进度 · ' : ''}
            {label}
          </span>
          {plan?.length ? (
            <span className="muted">
              · 已完成 {plan.filter((step) => step.status === 'completed').length}/{plan.length} 步
            </span>
          ) : null}
        </div>
      )}
    </MotionPresence>
  );
}
