import { t, useLocale } from '../../i18n';
import { useState, type ReactNode } from 'react';
import {
  ChevronRight,
  Layers,
  TerminalSquare,
  Pencil,
  Search,
  Image,
  Bot,
  Brain,
} from 'lucide-react';
import { historyKey, type HistoryEntry } from '../../history';
import { contentText } from '../../content-text';

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
        ? t('思考')
        : type === 'commandExecution'
          ? t('运行命令')
          : type === 'fileChange'
            ? t('修改文件')
            : type === 'webSearch'
              ? t('搜索')
              : ['imageView', 'imageGeneration'].includes(type)
                ? t('处理图片')
                : t('工具调用'),
    );
  }
  return [...labels].join('、');
}

function stageSummary(entries: HistoryEntry[], active: boolean) {
  const types = new Set(entries.map((entry) => String(entry.item?.type)));
  if (types.size === 1) {
    const type = String(entries[0]?.item?.type);
    if (type === 'commandExecution')
      return {
        icon: TerminalSquare,
        label: active ? t('正在执行命令') : t('已运行 {{p0}} 条命令', { p0: entries.length }),
      };
    if (type === 'fileChange') {
      const paths = new Set(
        entries.flatMap((entry) =>
          Array.isArray(entry.item?.changes)
            ? entry.item.changes.map((change: { path?: string }) => change.path).filter(Boolean)
            : [],
        ),
      );
      return {
        icon: Pencil,
        label: paths.size ? t('已修改 {{p0}} 个文件', { p0: paths.size }) : t('修改文件'),
      };
    }
    if (type === 'webSearch') return { icon: Search, label: t('搜索') };
    if (['imageView', 'imageGeneration'].includes(type))
      return { icon: Image, label: t('处理图片') };
    if (type === 'collabAgentToolCall') return { icon: Bot, label: t('Agent activity') };
    if (type === 'reasoning')
      return {
        icon: Brain,
        label: contentText(entries.at(-1)?.item).replace(/\s+/g, ' ').slice(0, 100) || t('思考'),
      };
  }
  return { icon: Layers, label: `${active ? t('正在') : ''}${stageLabel(entries)}` };
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
  useLocale();
  return activityStages(entries, activeTurn).map((stage) => {
    if (!stage.activity) {
      const index = stage.indices[0]!;
      return children(entries[index]!, index);
    }
    return <ActivityGroup key={stage.key} stage={stage} entries={entries} renderEntry={children} />;
  });
}

function ActivityGroup({
  stage,
  entries,
  renderEntry,
}: {
  stage: ReturnType<typeof activityStages>[number];
  entries: HistoryEntry[];
  renderEntry: (entry: HistoryEntry, index: number) => ReactNode;
}) {
  const [visited, setVisited] = useState(false);
  const { icon: Icon, label } = stageSummary(
    stage.indices.map((index) => entries[index]!),
    stage.active,
  );
  return (
    <details
      className="activity-stage"
      data-history-key={stage.key}
      data-active={stage.active || undefined}
      onToggle={(event) => {
        if (event.target === event.currentTarget && event.currentTarget.open) setVisited(true);
      }}
    >
      <summary>
        <Icon size={17} aria-hidden="true" />
        <span>{label}</span>
        {stage.active && <span className="activity-dot" aria-label={t('执行中')} />}
        <ChevronRight className="activity-stage-chevron" size={14} aria-hidden="true" />
      </summary>
      <div className="activity-stage-items">
        {visited && stage.indices.map((index) => renderEntry(entries[index]!, index))}
      </div>
    </details>
  );
}
