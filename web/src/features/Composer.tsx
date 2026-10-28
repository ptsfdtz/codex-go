import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUp,
  Plus,
  X,
  Square,
  Paperclip,
  Sparkles,
  FolderOpen,
  Expand,
  Minimize2,
  ListChecks,
  Target,
  CornerDownLeft,
  FileText,
} from 'lucide-react';
import { IconButton, Modal } from '../ui';
import { MotionPresence, usePopoverMotion } from '../motion';
import type { Attachment, Draft, Model } from '../workspace';
import { readAttachments } from './composer-input';
import { PermissionPicker } from './PermissionPicker';
import { ModelPicker } from './ModelPicker';

function AttachmentCard({
  attachment,
  disabled,
  onRemove,
  onPreview,
}: {
  attachment: Attachment;
  disabled: boolean;
  onRemove: () => void;
  onPreview: (url: string) => void;
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!/^image\/(png|jpeg|webp|gif|bmp)$/i.test(attachment.mime)) return;
    const bytes = Uint8Array.from(atob(attachment.data), (c) => c.charCodeAt(0));
    const value = URL.createObjectURL(new Blob([bytes], { type: attachment.mime }));
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [attachment]);
  return (
    <div className="composer-attachment">
      {url ? (
        <button
          className="attachment-thumbnail"
          aria-label={`预览图片 ${attachment.name}`}
          onClick={() => onPreview(url)}
        >
          <img src={url} alt={attachment.name} />
        </button>
      ) : (
        <FileText size={22} aria-hidden="true" />
      )}
      <span className="attachment-caption">
        <strong title={attachment.name}>{attachment.name}</strong>
        <small>
          {Math.ceil(attachment.bytes / 1024)} KiB{attachment.originalBytes ? ' · 已压缩' : ''}
        </small>
      </span>
      <IconButton
        icon={X}
        label={`移除附件 ${attachment.name}`}
        disabled={disabled}
        onClick={onRemove}
      />
    </div>
  );
}

export function Composer({
  draft,
  status,
  prompts,
  planConfirmation,
  queued,
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
  feedback,
  chat = false,
  execution = true,
  sendBlocked = false,
  attachmentTotalBytes = 512 * 1024,
}: {
  draft: Draft;
  status?: ReactNode;
  prompts?: ReactNode;
  planConfirmation?: ReactNode;
  queued?: ReactNode;
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
  feedback?: string;
  chat?: boolean;
  execution?: boolean;
  sendBlocked?: boolean;
  attachmentTotalBytes?: number;
}) {
  const menuId = useId();
  const feedbackId = useId();
  const [expanded, setExpanded] = useState(false),
    [addingAttachments, setAddingAttachments] = useState(false);
  const [attachmentError, setAttachmentError] = useState(''),
    [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ url: string; attachment: Attachment }>();
  const file = useRef<HTMLInputElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLButtonElement>(null),
    menu = usePopoverMotion();
  const latest = useRef(draft);
  latest.current = draft;
  const mounted = useRef(true),
    reading = useRef(false),
    dragDepth = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (preview && !draft.attachments.includes(preview.attachment)) setPreview(undefined);
  }, [draft.attachments, preview]);
  useLayoutEffect(() => {
    const node = textarea.current;
    if (!node) return;
    const resize = () => {
      node.style.height = '0px';
      const viewport = window.visualViewport?.height || window.innerHeight;
      const mobile = matchMedia('(max-width: 600px)').matches;
      const max = expanded
        ? Math.min(420, viewport * 0.5)
        : mobile
          ? Math.min(220, viewport * 0.3)
          : 220;
      const min = expanded ? Math.min(280, viewport * 0.4) : 36;
      const height = Math.min(Math.max(min, node.scrollHeight), Math.max(36, max));
      node.style.height = `${height}px`;
      node.style.overflowY = node.scrollHeight > height ? 'auto' : 'hidden';
    };
    resize();
    let width = node.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      resize();
    });
    observer.observe(node);
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, [draft.text, expanded, planConfirmation]);
  const hasResources = !!(
    draft.attachments.length ||
    draft.skills.length ||
    draft.references?.length
  );
  const hasContent = !!(draft.text.trim() || hasResources);
  const queueReason =
    execution &&
    active &&
    (!supports('nativeQueue')
      ? '当前电脑不支持队列，请等待任务完成或立即补充。'
      : draft.attachments.length && !supports('nativeQueueAttachments')
        ? '当前电脑不支持附件排队，请等待任务完成。'
        : draft.skills.length && !supports('nativeQueueSkills')
          ? '当前电脑不支持技能排队，请等待任务完成。'
          : draft.references?.length && !supports('fileReferenceInputs')
            ? '升级 Host 后可发送文件引用。'
            : '');
  const ready =
    !disabled &&
    !busy &&
    !addingAttachments &&
    !sendBlocked &&
    (!active || execution) &&
    hasContent;
  function closeMenu(focus = true) {
    menu.current?.hidePopover();
    if (focus) trigger.current?.focus();
  }
  async function addAttachments(files: File[]) {
    if (!files.length || disabled || busy || reading.current) return;
    if (!supports('attachments')) {
      setAttachmentError(execution ? '当前电脑不支持附件，请升级 Host' : '当前模式仅支持文字对话');
      return;
    }
    reading.current = true;
    setAddingAttachments(true);
    setAttachmentError('');
    try {
      const attachments = await readAttachments(
        files,
        latest.current.attachments,
        attachmentTotalBytes,
      );
      if (mounted.current) onChange({ attachments });
    } catch (error) {
      if (mounted.current) setAttachmentError(String(error));
    } finally {
      reading.current = false;
      if (mounted.current) setAddingAttachments(false);
    }
  }
  function changeText(text: string) {
    if (!execution) {
      onChange({ text });
      return;
    }
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
  function send() {
    if (ready && !queueReason) onSend(active ? 'queue' : undefined);
  }
  function isFileDrag(event: React.DragEvent) {
    return Array.from(event.dataTransfer.types).includes('Files');
  }
  return (
    <div className="composer-wrap">
      {prompts && (
        <div className="composer-prompts" aria-label="待处理请求">
          {prompts}
        </div>
      )}
      {status && <div className="composer-status">{status}</div>}
      {queued}
      {planConfirmation ? (
        <>
          {planConfirmation}
          <div className="plan-model-picker">
            <ModelPicker
              draft={draft}
              models={models}
              disabled={disabled || busy}
              onChange={onChange}
            />
          </div>
        </>
      ) : (
        <div
          className={`composer${expanded ? ' is-expanded' : ''}${dragging ? ' is-dragging' : ''}`}
          onDragEnter={(event) => {
            if (!isFileDrag(event)) return;
            event.preventDefault();
            dragDepth.current++;
            setDragging(true);
          }}
          onDragOver={(event) => {
            if (isFileDrag(event)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = disabled || busy ? 'none' : 'copy';
            }
          }}
          onDragLeave={(event) => {
            if (!isFileDrag(event)) return;
            if (--dragDepth.current <= 0) {
              dragDepth.current = 0;
              setDragging(false);
            }
          }}
          onDrop={(event) => {
            if (!isFileDrag(event)) return;
            event.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            void addAttachments(Array.from(event.dataTransfer.files));
          }}
        >
          {(hasResources || draft.mode !== 'default') && (
            <div className="composer-resources">
              {draft.mode !== 'default' && (
                <button
                  className="resource-chip mode-chip"
                  disabled={busy}
                  aria-label={`移除 ${draft.mode === 'goal' ? 'Goal' : 'Plan'} 模式`}
                  onClick={() => onChange({ mode: 'default' })}
                >
                  {draft.mode === 'goal' ? <Target size={14} /> : <ListChecks size={14} />}
                  <span>{draft.mode === 'goal' ? 'Goal' : 'Plan'}</span>
                  <X size={12} />
                </button>
              )}
              {draft.attachments.map((attachment, index) => (
                <AttachmentCard
                  key={`${index}:${attachment.name}`}
                  attachment={attachment}
                  disabled={busy || addingAttachments}
                  onRemove={() =>
                    onChange({ attachments: draft.attachments.filter((_, i) => i !== index) })
                  }
                  onPreview={(url) => setPreview({ url, attachment })}
                />
              ))}
              {(draft.references || []).map((reference) => (
                <span
                  className="resource-chip file-reference-chip"
                  key={reference.path}
                  title={reference.path}
                >
                  <FileText size={14} />
                  <span>{reference.name}</span>
                  <IconButton
                    icon={X}
                    label={`移除引用 ${reference.name}`}
                    disabled={busy}
                    onClick={() =>
                      onChange({
                        references: draft.references?.filter((ref) => ref.path !== reference.path),
                      })
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
          <textarea
            ref={textarea}
            aria-label="消息"
            aria-describedby={
              addingAttachments ||
              attachmentError ||
              feedback ||
              (active && hasContent && queueReason)
                ? feedbackId
                : undefined
            }
            value={draft.text}
            rows={1}
            onChange={(event) => changeText(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key !== 'Enter' ||
                event.shiftKey ||
                event.nativeEvent.isComposing ||
                event.keyCode === 229
              )
                return;
              const touch = matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
              if (touch && !event.ctrlKey && !event.metaKey) return;
              event.preventDefault();
              send();
            }}
            onPaste={(event) => {
              const images = Array.from(event.clipboardData.items)
                .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
                .map((item) => item.getAsFile())
                .filter((image): image is File => image !== null);
              if (!images.length) return;
              event.preventDefault();
              void addAttachments(images);
            }}
            placeholder={
              disabled
                ? execution
                  ? '连接电脑后开始'
                  : '暂时无法发送'
                : chat
                  ? '聊点什么…'
                  : '向 Codex 提问或描述任务…'
            }
            disabled={disabled || busy}
          />
          <div className="composer-toolbar">
            <button
              ref={trigger}
              className="icon-button composer-add"
              aria-label="添加附件和操作"
              popoverTarget={menuId}
              disabled={disabled || busy}
              onClick={(event) => {
                const node = menu.current;
                if (!node) return;
                const box = event.currentTarget.getBoundingClientRect();
                const viewport = window.visualViewport;
                const top = viewport?.offsetTop || 0;
                node.style.left = `${Math.max(12, Math.min(box.left, window.innerWidth - 272))}px`;
                node.style.bottom = `${window.innerHeight - box.top + 8}px`;
                node.style.maxHeight = `${Math.max(40, box.top - top - 20)}px`;
              }}
            >
              <Plus size={20} />
            </button>
            <div
              ref={menu}
              id={menuId}
              className="popover composer-menu"
              popover="auto"
              role="menu"
              onToggle={(event) => {
                if (event.newState === 'open')
                  menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
              }}
              aria-label="添加附件和操作"
              onKeyDown={(event) => {
                const items = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
                );
                const index = items.indexOf(document.activeElement as HTMLButtonElement);
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? items.length - 1
                        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
                          items.length;
                  items[next]?.focus();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  closeMenu();
                }
              }}
            >
              {supports('attachments') && (
                <button
                  role="menuitem"
                  disabled={addingAttachments}
                  onClick={() => {
                    closeMenu(false);
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
                    closeMenu(false);
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
                    closeMenu(false);
                    onPanel('files');
                  }}
                >
                  <FolderOpen size={17} />
                  浏览项目文件
                </button>
              )}
              {execution && <hr />}
              {execution &&
                (['default', 'plan', 'goal'] as const)
                  .filter((id) => id === 'default' || supports(id))
                  .map((id) => (
                    <button
                      role="menuitemradio"
                      aria-checked={draft.mode === id}
                      key={id}
                      onClick={() => {
                        onChange({ mode: id });
                        closeMenu();
                      }}
                    >
                      <ListChecks size={17} />
                      <span>{{ default: '默认模式', plan: 'Plan', goal: 'Goal' }[id]}</span>
                      {draft.mode === id && <span>✓</span>}
                    </button>
                  ))}
              {execution && <hr />}
              <button
                role="menuitem"
                onClick={() => {
                  setExpanded(!expanded);
                  closeMenu(false);
                  textarea.current?.focus();
                }}
              >
                {expanded ? <Minimize2 size={17} /> : <Expand size={17} />}
                {expanded ? '收起编辑器' : '展开编辑器'}
              </button>
              {active && supports('activeTurnSteering') && (
                <button
                  role="menuitem"
                  disabled={!ready || hasResources}
                  onClick={() => {
                    closeMenu(false);
                    onSend('steer');
                  }}
                >
                  <CornerDownLeft size={17} />
                  立即补充到当前任务
                </button>
              )}
            </div>
            <ModelPicker
              draft={draft}
              models={models}
              disabled={disabled || busy}
              onChange={onChange}
              allowDefault={execution}
            />
            <div className="composer-actions" role="group" aria-label="发送与执行控制">
              {execution && (
                <PermissionPicker
                  permission={permission}
                  disabled={disabled || busy}
                  onConfirm={onPermission}
                />
              )}
              {expanded && (
                <IconButton
                  icon={Minimize2}
                  label="收起编辑器"
                  onClick={() => {
                    setExpanded(false);
                    textarea.current?.focus();
                  }}
                />
              )}
              {active && (
                <IconButton
                  className="composer-stop"
                  icon={Square}
                  label="停止"
                  disabled={busy || disabled}
                  onClick={onStop}
                />
              )}
              {active && execution ? (
                <button
                  className="send-button composer-queue"
                  aria-label="加入队列"
                  title={queueReason || '加入队列'}
                  disabled={!ready || !!queueReason}
                  onClick={send}
                >
                  <ArrowUp size={15} />
                  <span>排队</span>
                </button>
              ) : !active ? (
                <IconButton
                  className="send-button"
                  icon={ArrowUp}
                  label={addingAttachments ? '正在读取或压缩附件…' : busy ? '处理中…' : '发送'}
                  disabled={!ready}
                  onClick={send}
                />
              ) : null}
            </div>
          </div>
          {(addingAttachments ||
            attachmentError ||
            feedback ||
            (active && hasContent && queueReason)) && (
            <div
              id={feedbackId}
              className="composer-feedback"
              role={attachmentError || feedback ? 'alert' : 'status'}
            >
              {attachmentError ||
                feedback ||
                (addingAttachments ? '正在读取或压缩附件，可继续输入…' : queueReason)}
            </div>
          )}
          {dragging && (
            <div className="composer-drop-hint" aria-hidden="true">
              松开以添加文件或图片
            </div>
          )}
          <input
            hidden
            multiple
            type="file"
            ref={file}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files || []);
              event.currentTarget.value = '';
              void addAttachments(files);
            }}
          />
        </div>
      )}
      <MotionPresence>
        {preview && (
          <Modal title={preview.attachment.name} onClose={() => setPreview(undefined)}>
            <img
              className="composer-image-preview"
              src={preview.url}
              alt={preview.attachment.name}
            />
          </Modal>
        )}
      </MotionPresence>
    </div>
  );
}
