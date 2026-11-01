import { t, useLocale } from '../i18n';
import { MotionPresence } from '../motion';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquarePlus } from 'lucide-react';

export function SelectionQuote({
  container,
  onQuote,
}: {
  container: RefObject<HTMLElement | null>;
  onQuote: (text: string) => void;
}) {
  useLocale();
  const [quote, setQuote] = useState<{ text: string; x: number; y: number }>();
  const button = useRef<HTMLButtonElement>(null);
  const callback = useRef(onQuote);
  callback.current = onQuote;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function read() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return undefined;
      const range = selection.getRangeAt(0);
      const element = (node: Node) => (node instanceof Element ? node : node.parentElement);
      const start = element(range.startContainer);
      const end = element(range.endContainer);
      if (!start || !end || !container.current?.contains(start) || !container.current.contains(end))
        return undefined;
      if (
        !start.closest('.timeline-content .message-content') ||
        !end.closest('.timeline-content .message-content') ||
        start.closest('input,textarea,[contenteditable="true"]') ||
        end.closest('input,textarea,[contenteditable="true"]')
      )
        return undefined;
      const text = selection.toString().trim();
      if (!text) return undefined;
      const rect = range.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight)
        return undefined;
      return {
        text,
        x: Math.max(12, Math.min(innerWidth - 152, rect.left + rect.width / 2 - 70)),
        y: Math.max(
          8,
          rect.top >= 48 ? rect.top - 42 : Math.min(innerHeight - 48, rect.bottom + 8),
        ),
      };
    }
    function update() {
      clearTimeout(timer);
      timer = setTimeout(() => setQuote(read()), 100);
    }
    function dismiss(event: Event) {
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      if (event.type === 'pointerdown' && button.current?.contains(event.target as Node)) return;
      if (event.type === 'keydown') window.getSelection()?.removeAllRanges();
      clearTimeout(timer);
      setQuote(undefined);
    }
    document.addEventListener('selectionchange', update);
    document.addEventListener('pointerup', update);
    document.addEventListener('keyup', update);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('pointerup', update);
      document.removeEventListener('keyup', update);
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [container]);
  return createPortal(
    <MotionPresence>
      {quote && (
        <button
          ref={button}
          type="button"
          className="selection-quote"
          style={{ left: quote.x, top: quote.y }}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            callback.current(quote.text);
            window.getSelection()?.removeAllRanges();
            setQuote(undefined);
          }}
        >
          <MessageSquarePlus size={15} />
          {t('添加到对话')}
        </button>
      )}
    </MotionPresence>,
    document.body,
  );
}

export function appendQuote(draft: string, selection: string): string {
  const quoted = selection
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
  return `${draft}${draft && !draft.endsWith('\n\n') ? (draft.endsWith('\n') ? '\n' : '\n\n') : ''}${quoted}\n\n`;
}
