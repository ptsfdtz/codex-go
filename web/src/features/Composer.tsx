import { MotionPresence } from '../motion';
import { useRef, useState, type ReactNode } from 'react';
import {
  ArrowUp,
  Plus,
  X,
  Square,
  Paperclip,
  Sparkles,
  FolderOpen,
  Expand,
  Shield,
  ListChecks,
  Target,
  MessageSquarePlus,
  Clock,
  CornerDownLeft,
} from 'lucide-react';
import { IconButton, Modal } from '../ui';
import type { Draft, Model } from '../workspace';
import { readAttachments } from './composer-input';

export function Composer({
  draft,
  status,
  onChange,
  models,
  supports,
  disabled,
  busy,
  active,
  permission,
  onPermission,
  onSend,
  onStop,
  onPanel,
  onNew,
  onError,
}: {
  draft: Draft;
  status?: ReactNode;
  onChange: (change: Partial<Draft>) => void;
  models: Model[];
  supports: (key: string) => boolean;
  disabled: boolean;
  busy: boolean;
  active: boolean;
  permission: string;
  onPermission: (s: string) => void;
  onSend: (kind?: 'queue' | 'steer') => void;
  onStop: () => void;
  onPanel: (panel: string) => void;
  onNew: () => void;
  onError: (s: string) => void;
}) {
  const [menu, setMenu] = useState(false),
    [expanded, setExpanded] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const model = models.find((m) => (m.id || m.model) === draft.model);
  const efforts =
    model?.supportedReasoningEfforts?.map((v) => (typeof v === 'string' ? v : v.reasoningEffort)) ||
    [];
  const hasResources = !!(draft.attachments.length || draft.skills.length);
  const ready = !disabled && !busy && !!(draft.text.trim() || hasResources);
  const keyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (ready) onSend(active ? 'queue' : undefined);
    }
  };
  function changeText(text: string) {
    const command = /^\/(plan|default|goal|skills|mention|queue|history|compact|new)\s$/.exec(text);
    if (!command) {
      onChange({ text });
      return;
    }
    const name = command[1]!;
    if (['plan', 'default', 'goal'].includes(name)) {
      if (name === 'default' || supports(name)) onChange({ mode: name, text: '' });
    } else if (name === 'new') onNew();
    else onPanel(({ mention: 'files', compact: 'manage' } as Record<string, string>)[name] || name);
  }
  const editor = (
    <textarea
      aria-label="消息"
      value={draft.text}
      onChange={(e) => changeText(e.target.value)}
      onKeyDown={keyDown}
      placeholder={disabled ? '连接电脑并选择项目后开始' : 'Ask Codex anything…'}
      disabled={disabled || busy}
      rows={expanded ? 16 : 2}
    />
  );
  return (
    <div className="composer-wrap">
      {status && <div className="composer-status">{status}</div>}
      <div className="composer">
        {(draft.attachments.length > 0 || draft.skills.length > 0) && (
          <div className="composer-resources">
            {draft.attachments.map((f, index) => (
              <span className="resource-chip" key={index}>
                <Paperclip size={14} />
                {f.name}
                <IconButton
                  icon={X}
                  label={`移除附件 ${f.name}`}
                  disabled={busy}
                  onClick={() =>
                    onChange({ attachments: draft.attachments.filter((_, i) => i !== index) })
                  }
                />
              </span>
            ))}
            {draft.skills.map((skill) => (
              <span className="resource-chip" key={skill.id}>
                <Sparkles size={14} />
                {skill.displayName || skill.name}
                <IconButton
                  icon={X}
                  label={`移除技能 ${skill.name}`}
                  disabled={busy}
                  onClick={() =>
                    onChange({ skills: draft.skills.filter((s) => s.id !== skill.id) })
                  }
                />
              </span>
            ))}
          </div>
        )}
        {!expanded && editor}
        <div className="composer-toolbar">
          <div className="menu-anchor">
            <IconButton
              icon={Plus}
              label="添加附件和操作"
              disabled={disabled || busy}
              onClick={() => setMenu(!menu)}
            />
            <MotionPresence>
              {menu && (
                <>
                  <button
                    className="menu-scrim"
                    aria-label="关闭添加菜单"
                    onClick={() => setMenu(false)}
                  />
                  <div className="popover composer-menu" role="menu">
                    {supports('attachments') && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          setMenu(false);
                          file.current?.click();
                        }}
                      >
                        <Paperclip size={17} />
                        添加文件或图片
                      </button>
                    )}
                    {supports('composerSkills') && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          setMenu(false);
                          onPanel('skills');
                        }}
                      >
                        <Sparkles size={17} />
                        技能
                      </button>
                    )}
                    {supports('projectFileBrowser') && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          setMenu(false);
                          onPanel('files');
                        }}
                      >
                        <FolderOpen size={17} />
                        浏览项目文件
                      </button>
                    )}
                    <hr />
                    {[
                      ['default', 'Default'],
                      ['plan', 'Plan'],
                      ['goal', 'Goal'],
                    ]
                      .filter(([id]) => id === 'default' || supports(id!))
                      .map(([id, name]) => (
                        <button
                          role="menuitem"
                          key={id}
                          onClick={() => {
                            onChange({ mode: id! });
                            setMenu(false);
                          }}
                        >
                          {id === 'goal' ? <Target size={17} /> : <ListChecks size={17} />}
                          <span>{name}</span>
                          {draft.mode === id && <span>✓</span>}
                        </button>
                      ))}
                    <hr />
                    <button
                      role="menuitem"
                      onClick={() => {
                        setExpanded(true);
                        setMenu(false);
                      }}
                    >
                      <Expand size={17} />
                      展开编辑器
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenu(false);
                        onNew();
                      }}
                    >
                      <MessageSquarePlus size={17} />
                      新对话
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenu(false);
                        onPanel('projects');
                      }}
                    >
                      <FolderOpen size={17} />
                      授权电脑项目
                    </button>
                  </div>
                </>
              )}
            </MotionPresence>
          </div>
          {draft.mode !== 'default' && (
            <button className="mode-chip" onClick={() => onChange({ mode: 'default' })}>
              {draft.mode === 'goal' ? <Target size={16} /> : <ListChecks size={16} />}
              <span>{draft.mode === 'goal' ? 'Goal' : 'Plan'}</span>
              <X size={12} />
            </button>
          )}
          <div className="composer-model">
            <select
              aria-label="模型"
              disabled={disabled || busy}
              value={draft.model}
              onChange={(e) => onChange({ model: e.target.value, effort: '' })}
            >
              <option value="">Default model</option>
              {models.map((m) => {
                const id = m.id || m.model;
                return id ? (
                  <option value={id} key={id}>
                    {m.displayName || m.name || id}
                  </option>
                ) : null;
              })}
            </select>
            {efforts.length > 0 && (
              <select
                aria-label="推理强度"
                value={draft.effort}
                onChange={(e) => onChange({ effort: e.target.value })}
                disabled={disabled || busy}
              >
                <option value="">Default reasoning</option>
                {efforts.map((e) => (
                  <option key={e}>{e}</option>
                ))}
              </select>
            )}
          </div>
          <button
            className="permission"
            title="执行权限"
            disabled={disabled || busy}
            onClick={() => onPermission(permission === 'workspace' ? 'full' : 'workspace')}
          >
            <Shield size={15} />
            <span>{permission === 'full' ? 'Full access' : 'Workspace'}</span>
          </button>
          {active && supports('activeTurnSteering') && !hasResources && (
            <IconButton
              icon={CornerDownLeft}
              label="立即补充到当前任务"
              disabled={!ready}
              onClick={() => onSend('steer')}
            />
          )}
          {active && ready && supports('nativeQueue') && (
            <IconButton icon={Clock} label="加入待发送队列" onClick={() => onSend('queue')} />
          )}
          {active ? (
            <IconButton
              className="send-button"
              icon={Square}
              label="停止"
              disabled={busy || disabled}
              onClick={onStop}
            />
          ) : (
            <IconButton
              className="send-button"
              icon={ArrowUp}
              label={busy ? '处理中…' : '发送'}
              disabled={!ready}
              onClick={() => onSend()}
            />
          )}
        </div>
        <input
          hidden
          multiple
          type="file"
          ref={file}
          onChange={(e) => {
            const input = e.currentTarget;
            const files = Array.from(input.files || []);
            input.value = '';
            void readAttachments(files, draft.attachments)
              .then((attachments) => onChange({ attachments }))
              .catch((e) => onError(String(e)));
          }}
        />
      </div>
      <p className="composer-hint">
        {active
          ? 'Codex is working. Add to the queue or steer the current task.'
          : 'Codex can make mistakes. Review changes before you run them.'}
      </p>
      <MotionPresence>
        {expanded && (
          <Modal title="编辑消息" wide onClose={() => setExpanded(false)}>
            {editor}
            <button onClick={() => setExpanded(false)}>完成</button>
          </Modal>
        )}
      </MotionPresence>
    </div>
  );
}
