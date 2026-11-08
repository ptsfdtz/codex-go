import { useSendMotion } from './use-send-motion';
import { errorText, t, useLocale } from '../i18n';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUp,
  Plus,
  X,
  Square,
  Sparkles,
  ListChecks,
  ListPlus,
  Target,
  FileText,
  Mic,
} from 'lucide-react';
import { IconButton, Modal } from '../ui';
import { MotionPresence, usePopoverMotion } from '../motion';
import type { Attachment, Draft, Model } from '../workspace';
import { readAttachments } from './composer-input';
import { ComposerSuggestions } from './ComposerSuggestions';
import type { Request } from '../workspace';
import { ComposerMenu } from './ComposerMenu';
import { positionPopover } from '../components/popover';
import { PermissionPicker } from './PermissionPicker';
import { ModelPicker } from './ModelPicker';
import { useSpeechInput } from './speech/use-speech-input';

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
  useLocale();
  const [url, setUrl] = useState('');
  const image = /^image\/(png|jpeg|webp|gif|bmp)$/i.test(attachment.mime);
  useEffect(() => {
    if (!image) return;
    const bytes = Uint8Array.from(atob(attachment.data), (c) => c.charCodeAt(0));
    const value = URL.createObjectURL(new Blob([bytes], { type: attachment.mime }));
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [attachment, image]);
  return (
    <div className="composer-attachment" data-image={image || undefined}>
      {url ? (
        <button
          className="attachment-thumbnail"
          aria-label={t('预览图片 {{p0}}', { p0: attachment.name })}
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
          {Math.ceil(attachment.bytes / 1024)} {t(' KiB')}
          {attachment.originalBytes ? t(' · 已压缩') : ''}
        </small>
      </span>
      <IconButton
        icon={X}
        className="attachment-remove"
        label={t('移除附件 {{p0}}', { p0: attachment.name })}
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
  disabledReason,
  attachmentTotalBytes = 512 * 1024,
  panels,
  placeholder,
  contextControl,
  request,
  projectId,
  sessionId,
}: {
  request?: Request;
  projectId?: string;
  sessionId?: string;
  panels?: string[];
  placeholder?: string;
  contextControl?: ReactNode;
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
  disabledReason?: string;
  attachmentTotalBytes?: number;
}) {
  useLocale();
  const menuId = useId();
  const suggestionId = useId();
  const [caret, setCaret] = useState(0);
  const [dismissedSuggestion, setDismissedSuggestion] = useState<string>();
  const feedbackId = useId();
  const speechStatusId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const focusMenu = useRef(false);
  const [addingAttachments, setAddingAttachments] = useState(false);
  const [focused, setFocused] = useState(false);
  const suggestionOpen =
    execution &&
    focused &&
    !disabled &&
    !busy &&
    dismissedSuggestion !== draft.text &&
    /(?:^|\s)[@/][^\s@/]*$/.test(draft.text.slice(0, caret));

  const composerRoot = useRef<HTMLDivElement>(null);
  const modelInteraction = useRef<HTMLDivElement>(null);
  const keyboardDictation = useRef(false);
  useEffect(() => {
    // Safari buttons may blur the editor with no relatedTarget. Preserve the
    // layout for actions inside the composer without canceling native touches
    // (including the first touch after a system permission dialog).
    const outside = (event: PointerEvent) => {
      const root = composerRoot.current;
      if (
        event.target instanceof Node &&
        !root?.contains(event.target) &&
        !modelInteraction.current?.isConnected &&
        !root?.querySelector('.model-picker-popup:popover-open')
      )
        setFocused(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, []);
  const [attachmentError, setAttachmentError] = useState(''),
    [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ url: string; attachment: Attachment }>();
  const file = useRef<HTMLInputElement>(null),
    photos = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null);
  const beginSendMotion = useSendMotion(
    textarea,
    draft,
    busy,
    disabled || sendBlocked || !!feedback,
  );
  const trigger = useRef<HTMLButtonElement>(null),
    menu = usePopoverMotion();
  useEffect(() => {
    const update = () => {
      if (trigger.current && menu.current?.matches(':popover-open'))
        positionPopover(trigger.current, menu.current, { width: 292, preferAbove: true });
    };
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [menu]);
  useEffect(() => {
    if (disabled || busy) menu.current?.hidePopover();
  }, [disabled, busy, menu]);
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
      const mobile = matchMedia('(max-width: 760px)').matches;
      let max = mobile ? Math.min(220, viewport * 0.3) : 220;
      const min = 36;
      const wrap = node.closest('.composer-wrap');
      const conversation = wrap?.parentElement;
      if (mobile && wrap && conversation?.classList.contains('conversation')) {
        const occupiedHeight = (element: Element): number =>
          getComputedStyle(element).display === 'contents'
            ? Array.from(element.children).reduce((sum, child) => sum + occupiedHeight(child), 0)
            : element.getBoundingClientRect().height;
        const chrome = Array.from(conversation.children)
          .filter((child) => child !== wrap && !child.classList.contains('timeline'))
          .reduce((sum, child) => sum + occupiedHeight(child), 0);
        const controls = wrap.getBoundingClientRect().height - node.getBoundingClientRect().height;
        max = Math.min(max, conversation.clientHeight - chrome - controls - 8);
      }
      const height = Math.min(Math.max(min, node.scrollHeight), Math.max(36, max));
      node.style.height = `${height}px`;
      node.style.overflowY = node.scrollHeight > height ? 'auto' : 'hidden';
    };
    resize();
    let resizeFrame: number | undefined;
    const scheduleResize = () => {
      if (resizeFrame !== undefined) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined;
        resize();
      });
    };
    let width = node.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      const measuredWidth = node.getBoundingClientRect().width;
      if (!entry || measuredWidth === width) return;
      width = measuredWidth;
      scheduleResize();
    });
    observer.observe(node);
    const chromeObserver = new ResizeObserver(scheduleResize);
    node
      .closest('.composer-wrap')
      ?.querySelectorAll(
        '.composer-toolbar, .composer-status, .composer-resources, .composer-prompts, .queued-messages',
      )
      .forEach((chrome) => chromeObserver.observe(chrome));
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      chromeObserver.disconnect();
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, [
    draft.text,
    draft.mode,
    draft.attachments,
    draft.skills,
    draft.references,
    focused,
    active,
    planConfirmation,
  ]);
  const speech = useSpeechInput({
    value: draft.text,
    disabled: disabled || busy,
    input: textarea,
    onText: (text) => onChange({ text }),
  });
  useLayoutEffect(() => {
    if (!keyboardDictation.current) return;
    const selector = speech.active ? '.recording-stop' : '.composer-mic';
    composerRoot.current
      ?.querySelector<HTMLButtonElement>(selector)
      ?.focus({ preventScroll: true });
    if (!speech.active) keyboardDictation.current = false;
  }, [speech.active]);
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
      ? t('当前电脑不支持队列，请等待任务完成或立即补充。')
      : draft.attachments.length && !supports('nativeQueueAttachments')
        ? t('当前电脑不支持附件排队，请等待任务完成。')
        : draft.skills.length && !supports('nativeQueueSkills')
          ? t('当前电脑不支持技能排队，请等待任务完成。')
          : draft.references?.length && !supports('fileReferenceInputs')
            ? t('升级 Host 后可发送文件引用。')
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
    if (focus) trigger.current?.focus({ preventScroll: true });
  }
  async function addAttachments(files: File[]) {
    if (!files.length || disabled || busy || reading.current) return;
    if (!supports('attachments')) {
      setAttachmentError(
        execution ? t('当前电脑不支持附件，请升级 Host') : t('当前模式仅支持文字对话'),
      );
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
    else {
      const panel =
        ({ mention: 'files', compact: 'manage' } as Record<string, string>)[name] || name;
      if (!panels || panels.includes(panel)) onPanel(panel);
      else onChange({ text });
    }
  }
  function submit() {
    beginSendMotion();
    onSend(active ? 'queue' : undefined);
  }
  function send() {
    if (ready && !queueReason && !speech.active) submit();
  }
  function isFileDrag(event: React.DragEvent) {
    return Array.from(event.dataTransfer.types).includes('Files');
  }
  const canSteer = active && supports('activeTurnSteering');
  const hasMenuActions =
    supports('attachments') ||
    supports('composerSkills') ||
    (execution && (supports('plan') || supports('goal'))) ||
    canSteer;
  return (
    <div
      ref={composerRoot}
      className="composer-wrap"
      onMouseDownCapture={(event) => {
        // Keep an active mobile keyboard when tapping composer controls. The
        // native click, popover activation and range dragging still run.
        if (
          document.activeElement === textarea.current &&
          matchMedia('(pointer: coarse)').matches &&
          event.target instanceof Element &&
          event.target.closest(
            '.model-picker-trigger, .model-picker-popup button, .composer-mic, .composer-recording button',
          )
        )
          event.preventDefault();
      }}
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLTextAreaElement && event.target === textarea.current)
          setFocused(true);
      }}
      onBlurCapture={(event) => {
        if (
          modelInteraction.current?.isConnected ||
          document.querySelector('dialog[open], [popover]:popover-open')
        )
          return;
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
          setFocused(false);
      }}
    >
      {suggestionOpen && (
        <ComposerSuggestions
          id={suggestionId}
          draft={draft}
          caret={caret}
          supports={(key) => (key !== 'turnResponseSpeed' || !active) && supports(key)}
          request={request}
          projectId={projectId}
          sessionId={sessionId}
          onChange={onChange}
          onPanel={onPanel}
          onNew={onNew}
          onClose={() => {
            setDismissedSuggestion(draft.text);
            textarea.current?.focus({ preventScroll: true });
          }}
        />
      )}
      {prompts && (
        <div className="composer-prompts" aria-label={t('待处理请求')}>
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
              allowResponseSpeed={!active && supports('turnResponseSpeed')}
            />
          </div>
        </>
      ) : (
        <div
          className={`composer${execution && active ? ' is-follow-up' : ''}${dragging ? ' is-dragging' : ''}${speech.active ? ' is-dictating' : ''}${!speech.active && !focused && !hasResources && draft.mode === 'default' && !draft.text.includes('\n') ? ' is-compact' : ''}${!hasContent ? ' is-empty' : ''}`}
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
              {draft.attachments.length > 0 && (
                <div className="composer-attachments">
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
                </div>
              )}
              {draft.mode !== 'default' && (
                <button
                  className="resource-chip mode-chip composer-tag"
                  disabled={busy}
                  aria-label={t('移除 {{p0}} 模式', {
                    p0: draft.mode === 'goal' ? t('目标') : t('计划'),
                  })}
                  onClick={() => onChange({ mode: 'default' })}
                >
                  {draft.mode === 'goal' ? <Target size={14} /> : <ListChecks size={14} />}
                  <span className="composer-tag-name">
                    {draft.mode === 'goal' ? t('目标') : t('计划')}
                  </span>
                  <span className="composer-tag-remove" aria-hidden="true">
                    <X size={12} />
                  </span>
                </button>
              )}
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
                    label={t('移除引用 {{p0}}', { p0: reference.name })}
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
                <span className="resource-chip composer-tag" key={skill.id}>
                  <Sparkles size={14} aria-hidden="true" />
                  <span className="composer-tag-name" title={skill.displayName || skill.name}>
                    {skill.displayName || skill.name}
                  </span>
                  <IconButton
                    className="composer-tag-remove"
                    icon={X}
                    label={t('移除技能 {{p0}}', { p0: skill.name })}
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
            aria-label={t('消息')}
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
            aria-controls={suggestionOpen ? suggestionId : undefined}
            aria-autocomplete={execution ? 'list' : undefined}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            onFocus={() => {
              if (speech.active) speech.cancel();
            }}
            onPointerDown={() => {
              if (speech.active) speech.cancel();
            }}
            onBeforeInput={() => {
              if (speech.active) speech.cancel();
            }}
            onChange={(event) => {
              speech.cancel();
              setCaret(event.target.selectionStart);
              setDismissedSuggestion(undefined);
              changeText(event.target.value);
            }}
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
                ? disabledReason || (execution ? t('连接电脑后开始') : t('暂时无法发送'))
                : execution && active
                  ? t('跟进')
                  : chat
                    ? t('聊点什么…')
                    : placeholder || t('向 Codex 提问或描述任务…')
            }
            disabled={disabled || busy}
          />
          {speech.active && (
            <div className="composer-recording" role="group" aria-label={t('正在听写')}>
              <IconButton
                icon={X}
                label={t('取消本次听写')}
                className="recording-control"
                onClick={speech.discard}
              />
              <span
                className="recording-dots"
                data-listening={speech.phase === 'listening'}
                aria-hidden="true"
              />
              <IconButton
                icon={Square}
                label={t('结束语音输入')}
                className="recording-control recording-stop"
                disabled={speech.phase === 'stopping'}
                onClick={speech.stop}
              />
              <IconButton
                icon={ArrowUp}
                label={execution && active ? t('加入队列') : t('发送')}
                className="recording-control recording-send"
                disabled={!ready || !!queueReason || speech.phase === 'stopping'}
                onClick={() => {
                  speech.cancel();
                  submit();
                }}
              />
            </div>
          )}
          <div className="composer-toolbar" hidden={speech.active}>
            {hasMenuActions && (
              <button
                type="button"
                ref={trigger}
                className="icon-button composer-add"
                aria-label={t('添加附件和操作')}
                popoverTarget={menuId}
                aria-haspopup="menu"
                aria-controls={menuId}
                aria-expanded={menuOpen}
                disabled={disabled || busy}
                onClick={(event) => {
                  focusMenu.current =
                    event.detail === 0 || !matchMedia('(pointer: coarse)').matches;
                  if (menu.current)
                    positionPopover(event.currentTarget, menu.current, {
                      width: 292,
                      preferAbove: true,
                    });
                }}
              >
                <Plus size={20} />
              </button>
            )}
            {execution && (
              <PermissionPicker
                permission={permission}
                disabled={disabled || busy}
                onConfirm={onPermission}
              />
            )}
            <ComposerMenu
              id={menuId}
              menu={menu}
              disabled={disabled || busy}
              addingAttachments={addingAttachments}
              supports={supports}
              mode={draft.mode}
              execution={execution}
              steering={!canSteer ? 'hidden' : ready && !hasResources ? 'ready' : 'disabled'}
              onCamera={() => camera.current?.click()}
              onPhotos={() => photos.current?.click()}
              onFiles={() => file.current?.click()}
              onPanel={onPanel}
              onMode={(mode) => onChange({ mode })}
              onSteer={() => {
                beginSendMotion();
                onSend('steer');
              }}
              onClose={closeMenu}
              onToggle={(open) => {
                setMenuOpen(open);
                if (open && focusMenu.current)
                  menu.current
                    ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
                    ?.focus({ preventScroll: true });
              }}
            />
            <div className="composer-toolbar-spacer" />
            {contextControl}
            <ModelPicker
              draft={draft}
              models={models}
              disabled={disabled || busy}
              onChange={onChange}
              allowResponseSpeed={!active && supports('turnResponseSpeed')}
              onOpenChange={(open, panel) => {
                if (open) {
                  modelInteraction.current = panel;
                  setFocused(true);
                } else {
                  // WebKit may deliver focus changes while light dismissal is
                  // still completing. Treat them as part of model selection.
                  requestAnimationFrame(() => {
                    if (modelInteraction.current === panel && !panel.matches(':popover-open'))
                      modelInteraction.current = null;
                  });
                }
              }}
            />
            <div className="composer-actions" role="group" aria-label={t('发送与执行控制')}>
              <button
                type="button"
                className="icon-button composer-mic"
                aria-label={t('语音输入')}
                title={t('语音输入')}
                aria-describedby={speech.message ? speechStatusId : undefined}
                disabled={disabled || busy}
                onClick={(event) => {
                  keyboardDictation.current = event.detail === 0;
                  speech.start();
                }}
              >
                <Mic size={23} />
              </button>
              {active && execution && hasContent ? (
                <button
                  type="button"
                  className="icon-button send-button composer-queue"
                  aria-label={t('加入队列')}
                  title={queueReason || t('加入队列')}
                  disabled={!ready || !!queueReason}
                  onClick={send}
                >
                  <ListPlus size={19} strokeWidth={1.6} aria-hidden="true" />
                </button>
              ) : active ? (
                <IconButton
                  className="send-button composer-stop"
                  icon={Square}
                  label={t('停止')}
                  disabled={busy || disabled}
                  onClick={onStop}
                />
              ) : (
                <IconButton
                  className="send-button"
                  icon={ArrowUp}
                  label={
                    addingAttachments ? t('正在读取或压缩附件…') : busy ? t('处理中…') : t('发送')
                  }
                  disabled={!ready}
                  onClick={send}
                />
              )}
              {active && execution && hasContent && (
                <IconButton
                  className="send-button composer-stop"
                  icon={Square}
                  label={t('停止')}
                  disabled={busy || disabled}
                  onClick={onStop}
                />
              )}
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
                (addingAttachments ? t('正在读取或压缩附件，可继续输入…') : queueReason)}
            </div>
          )}
          {dragging && (
            <div className="composer-drop-hint" aria-hidden="true">
              {t('松开以添加文件或图片')}
            </div>
          )}
          <input
            hidden
            multiple
            type="file"
            accept="image/*"
            ref={photos}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files || []);
              event.currentTarget.value = '';
              void addAttachments(files);
            }}
          />
          <input
            hidden
            type="file"
            accept="image/*"
            capture="environment"
            ref={camera}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files || []);
              event.currentTarget.value = '';
              void addAttachments(files);
            }}
          />
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
      <span
        id={speechStatusId}
        className="visually-hidden composer-speech-status"
        role="status"
        aria-live="polite"
      >
        {speech.message
          ? errorText(speech.message)
          : speech.phase === 'listening'
            ? t('正在听写')
            : ''}
      </span>
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
