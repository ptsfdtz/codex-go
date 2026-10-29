import { useId, useLayoutEffect, useRef } from 'react';
import { ArrowUp, LoaderCircle } from 'lucide-react';

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
  const errorId = useId();
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
    const resize = () => {
      node.style.height = '0px';
      const max = Math.min(320, (window.visualViewport?.height || window.innerHeight) * 0.35);
      node.style.height = `${Math.min(Math.max(40, node.scrollHeight), Math.max(40, max))}px`;
    };
    resize();
    let width = node.clientWidth;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || node.clientWidth === width) return;
      width = node.clientWidth;
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
  }, [text]);
  return (
    <form
      className="message-editor"
      aria-label="编辑消息"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && !busy && text.trim()) onSend();
      }}
    >
      <textarea
        ref={textarea}
        aria-label="修改消息"
        aria-describedby={error ? errorId : undefined}
        rows={1}
        value={text}
        readOnly={busy}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Escape' && !busy) {
            event.preventDefault();
            onCancel();
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            if (!disabled && !busy && text.trim()) onSend();
          }
        }}
      />
      {error && (
        <p id={errorId} className="message-edit-error" role="alert">
          {error}
        </p>
      )}
      <div className="message-edit-footer">
        <div className="message-edit-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            type="submit"
            className="message-edit-send"
            disabled={disabled || busy || !text.trim()}
          >
            {busy ? (
              <LoaderCircle size={15} className="pending-icon" aria-hidden="true" />
            ) : (
              <ArrowUp size={15} aria-hidden="true" />
            )}
            {busy ? '发送中…' : '保存并发送'}
          </button>
        </div>
      </div>
    </form>
  );
}
