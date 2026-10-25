import { useLayoutEffect, useRef } from 'react';

export function MessageEditor({
  text,
  busy,
  disabled,
  error,
  onChange,
  onCancel,
  onSend,
}: {
  text: string;
  busy: boolean;
  disabled: boolean;
  error: string;
  onChange: (text: string) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    textarea.current?.focus({ preventScroll: true });
    textarea.current?.setSelectionRange(
      textarea.current.value.length,
      textarea.current.value.length,
    );
    const frame = requestAnimationFrame(() =>
      textarea.current?.closest('form')?.scrollIntoView({ block: 'nearest' }),
    );
    return () => cancelAnimationFrame(frame);
  }, []);
  useLayoutEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 420)}px`;
  }, [text]);
  return (
    <form
      className="message-editor"
      aria-label="编辑消息"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && text.trim()) onSend();
      }}
    >
      <textarea
        ref={textarea}
        aria-label="修改消息"
        aria-describedby="message-edit-hint"
        rows={2}
        value={text}
        readOnly={busy}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape' && !busy) {
            event.preventDefault();
            onCancel();
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            if (!disabled && text.trim()) onSend();
          }
        }}
      />
      <p id="message-edit-hint" className="message-edit-hint">
        发送后将替换此消息并回退后续回复，保留原附件和技能。
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="message-edit-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="message-edit-send" disabled={disabled || !text.trim()}>
          {busy ? '发送中…' : '保存并发送'}
        </button>
      </div>
    </form>
  );
}
