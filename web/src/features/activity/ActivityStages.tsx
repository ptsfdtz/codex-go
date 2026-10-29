import type { ReactNode } from 'react';
import { ChevronRight, Layers } from 'lucide-react';
import { historyKey, type HistoryEntry } from '../../history';
import { contentText } from '../../RichContent';

const activityTypes = new Set([
  'reasoning',
  'commandExecution',
  'fileChange',
  'webSearch',
  'mcpToolCall',
  'dynamicToolCall',
  'imageView',
  'imageGeneration',
  'collabAgentToolCall',
  'contextCompaction',
]);

export function activityStages(entries: HistoryEntry[], activeTurn?: string) {
  const stages: { key: string; activity: boolean; active: boolean; indices: number[] }[] = [];
  entries.forEach((entry, index) => {
    if (entry.item?.type === 'reasoning' && !contentText(entry.item)) return;
    const activity =
      activityTypes.has(String(entry.item?.type)) &&
      !['user', 'assistant'].includes(String(entry.item?.role));
    const previous = stages.at(-1);
    if (activity && previous?.activity && entries[previous.indices[0]!]!.turnId === entry.turnId) {
      previous.indices.push(index);
    } else {
      stages.push({ key: historyKey(entry), activity, active: false, indices: [index] });
    }
  });
  const last = stages.at(-1);
  if (last?.activity && activeTurn && entries[last.indices[0]!]!.turnId === activeTurn)
    last.active = true;
  return stages;
}

function stageLabel(entries: HistoryEntry[]) {
  const labels = new Set<string>();
  for (const entry of entries) {
    const type = String(entry.item?.type);
    labels.add(
      type === 'reasoning'
        ? '思考'
        : type === 'commandExecution'
          ? '运行命令'
          : type === 'fileChange'
            ? '修改文件'
            : type === 'webSearch'
              ? '搜索'
              : ['imageView', 'imageGeneration'].includes(type)
                ? '处理图片'
                : '工具调用',
    );
  }
  return [...labels].join('、');
}

export function ActivityStages({
  entries,
  activeTurn,
  children,
}: {
  entries: HistoryEntry[];
  activeTurn?: string;
  children: (entry: HistoryEntry, index: number) => ReactNode;
}) {
  return activityStages(entries, activeTurn).map((stage) => {
    if (!stage.activity) {
      const index = stage.indices[0]!;
      return children(entries[index]!, index);
    }
    return (
      <details
        className="activity-stage"
        key={stage.key}
        data-history-key={stage.key}
        open={stage.active}
      >
        <summary>
          <Layers size={15} aria-hidden="true" />
          <span>
            {stage.active ? '正在' : ''}
            {stageLabel(stage.indices.map((i) => entries[i]!))}
          </span>
          <span className="activity-stage-count">{stage.indices.length}</span>
          {stage.active && <span className="activity-dot" aria-label="执行中" />}
          <ChevronRight className="activity-stage-chevron" size={14} aria-hidden="true" />
        </summary>
        <div className="activity-stage-items">
          {stage.indices.map((index) => children(entries[index]!, index))}
        </div>
      </details>
    );
  });
}
