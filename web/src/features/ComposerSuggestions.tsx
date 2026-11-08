import { useEffect, useState } from 'react';
import {
  Blocks,
  Zap,
  ListChecks,
  Target,
  Gauge,
  Files,
  History,
  Plus,
  MessagesSquare,
} from 'lucide-react';
import { t, errorText } from '../i18n';
import type { Draft, Request, Skill } from '../workspace';
import './composer-suggestions.css';

export function ComposerSuggestions({
  draft,
  caret,
  supports,
  request,
  projectId,
  sessionId,
  onChange,
  onPanel,
  onNew,
  onClose,
  id,
}: {
  draft: Draft;
  caret: number;
  supports: (key: string) => boolean;
  request?: Request;
  projectId?: string;
  sessionId?: string;
  onChange: (value: Partial<Draft>) => void;
  onPanel: (panel: string) => void;
  onNew: () => void;
  onClose: () => void;
  id: string;
}) {
  const match = /(?:^|\s)([@/])([^\s@/]*)$/.exec(draft.text.slice(0, caret));
  const kind = match?.[1],
    query = match?.[2]?.toLowerCase() || '';
  const skillsSupported = supports('composerSkills');
  const [catalog, setCatalog] = useState<Skill[]>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (kind !== '@' || !request || !projectId || !skillsSupported) return;
    let cancelled = false;
    setCatalog(undefined);
    setError('');
    void request<{ skills: Skill[] }>('skills.catalog', { projectId }).then(
      (value) => {
        if (!cancelled) setCatalog(value.skills);
      },
      (reason) => {
        if (!cancelled) setError(errorText(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [kind, request, projectId, attempt, skillsSupported]);
  const remaining = draft.text.slice(0, caret - query.length - 1) + draft.text.slice(caret);
  const commands = [
    {
      name: 'fast',
      title: t('快速'),
      description: t('切换快速模式'),
      icon: Zap,
      available: supports('turnResponseSpeed'),
      run: () =>
        onChange({
          text: remaining,
          responseSpeed: draft.responseSpeed === 'fast' ? 'default' : 'fast',
        }),
    },
    {
      name: 'plan',
      title: t('计划'),
      description: t('切换计划模式'),
      icon: ListChecks,
      available: supports('plan'),
      run: () => onChange({ text: remaining, mode: draft.mode === 'plan' ? 'default' : 'plan' }),
    },
    {
      name: 'goal',
      title: t('目标'),
      description: t('为 Codex 设定持续处理的目标'),
      icon: Target,
      available: supports('goal'),
      run: () => onChange({ text: remaining, mode: 'goal' }),
    },
    {
      name: 'status',
      title: t('状态'),
      description: t('查看会话状态'),
      icon: Gauge,
      available: !!sessionId,
      run: () => {
        onChange({ text: remaining });
        onPanel('manage');
      },
    },
    {
      name: 'side',
      title: t('侧边对话'),
      description: t('不打断当前任务，另开对话提个小问题'),
      icon: MessagesSquare,
      available: !!request && !!projectId,
      run: () => {
        onChange({ text: remaining });
        onPanel('side');
      },
    },
    {
      name: 'mention',
      title: t('文件'),
      description: t('浏览项目文件'),
      icon: Files,
      available: supports('fileReferenceInputs'),
      run: () => {
        onChange({ text: remaining });
        onPanel('files');
      },
    },
    {
      name: 'history',
      title: t('历史'),
      description: t('查看会话历史'),
      icon: History,
      available: !!sessionId,
      run: () => {
        onChange({ text: remaining });
        onPanel('history');
      },
    },
    {
      name: 'new',
      title: t('新建对话'),
      description: t('开始新的对话'),
      icon: Plus,
      available: true,
      run: () => {
        onChange({ text: remaining });
        onNew();
      },
    },
  ];
  const rows =
    kind === '@'
      ? (catalog || [])
          .filter((s) => s.enabled && !draft.skills.some((selected) => selected.id === s.id))
          .map((skill) => ({
            name: skill.name,
            title: skill.displayName || skill.name,
            description: skill.shortDescription || skill.description || '',
            icon: Blocks,
            available: draft.skills.length < 8,
            run: () => onChange({ text: remaining, skills: [...draft.skills, skill] }),
          }))
      : commands;
  const filtered = rows.filter(
    (row) =>
      row.available && `${row.name} ${row.title} ${row.description}`.toLowerCase().includes(query),
  );
  const selected = Math.min(index, Math.max(0, filtered.length - 1));
  useEffect(() => {
    setIndex(0);
  }, [query, kind]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if (['ArrowUp', 'ArrowDown'].includes(event.key) && filtered.length) {
        event.preventDefault();
        setIndex(
          (selected + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length,
        );
      }
      if (event.key === 'Enter' && !event.shiftKey && filtered[selected]) {
        event.preventDefault();
        event.stopPropagation();
        filtered[selected]!.run();
        onClose();
      }
    };
    document.addEventListener('keydown', keydown, true);
    document.getElementById(`${id}-${selected}`)?.scrollIntoView({ block: 'nearest' });
    return () => document.removeEventListener('keydown', keydown, true);
  });
  return (
    <div
      className="composer-suggestions"
      id={id}
      role="listbox"
      aria-label={kind === '@' ? t('技能') : t('命令')}
      onMouseDown={(event) => event.preventDefault()}
    >
      {filtered.map((row, i) => (
        <button
          type="button"
          role="option"
          aria-selected={selected === i}
          id={`${id}-${i}`}
          key={row.name}
          onClick={() => {
            row.run();
            onClose();
          }}
        >
          <row.icon size={23} />
          <span>
            <strong>{row.title}</strong>
            <small>{row.description}</small>
          </span>
          <em>{kind === '@' ? t('技能') : t('命令')}</em>
        </button>
      ))}
      {!filtered.length && (
        <div className="suggestion-empty">
          {error ||
            (kind === '@' && !catalog && request && supports('composerSkills')
              ? t('加载中…')
              : t('没有可用的匹配项'))}
          {error && <button onClick={() => setAttempt(attempt + 1)}>{t('重试')}</button>}
        </div>
      )}
    </div>
  );
}
