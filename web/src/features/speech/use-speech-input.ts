import { t, getLocale } from '../../i18n';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

// Keep the prefixed Web Speech API local: TypeScript's DOM library does not
// declare recognition consistently across browsers.
type SpeechResult = { isFinal: boolean; 0?: { transcript: string } };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<SpeechResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionConstructor = new () => Recognition;
type SpeechWindow = Window & {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
};
type Phase = 'idle' | 'starting' | 'listening' | 'stopping';
type Session = {
  recognition: Recognition;
  expected: string;
  before: string;
  after: string;
  committed: Map<number, string>;
  deadline?: ReturnType<typeof setTimeout>;
  finishing?: ReturnType<typeof setTimeout>;
  disconnect: () => void;
  cancel: () => void;
};

// One microphone per page, including main chat, side chat and AgentChat.
let cancelCurrent: (() => void) | undefined;
const errors: Record<string, string> = {
  get 'not-allowed'() {
    return t('请允许麦克风权限');
  },
  get 'service-not-allowed'() {
    return t('语音服务不可用');
  },
  get 'audio-capture'() {
    return t('麦克风不可用');
  },
  get network() {
    return t('语音连接失败，请重试');
  },
  get 'language-not-supported'() {
    return t('语音服务不支持当前语言');
  },
};

export function useSpeechInput({
  value,
  disabled,
  input,
  onText,
}: {
  value: string;
  disabled: boolean;
  input: RefObject<HTMLTextAreaElement | null>;
  onText: (text: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const current = useRef<Session>(undefined);
  const latest = useRef({ value, disabled, onText });
  latest.current = { value, disabled, onText };
  const Constructor =
    (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
  const unavailable = !window.isSecureContext
    ? t('语音输入需要 HTTPS')
    : !Constructor
      ? t('当前浏览器不支持语音输入')
      : '';
  function visible() {
    const node = input.current;
    return (
      !!node &&
      node.getClientRects().length > 0 &&
      !node.closest('[hidden], [inert]') &&
      document.visibilityState === 'visible'
    );
  }
  function release(session: Session, { update = true, abort = true } = {}) {
    if (current.current !== session) return;
    current.current = undefined;
    if (cancelCurrent === session.cancel) cancelCurrent = undefined;
    clearTimeout(session.deadline);
    clearTimeout(session.finishing);
    session.disconnect();
    const recognition = session.recognition;
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    if (abort) {
      try {
        recognition.abort();
      } catch {
        /* Some engines throw after ending. */
      }
    }
    if (update) {
      setPhase('idle');
    }
  }
  function cancel() {
    const session = current.current;
    if (session) release(session);
  }
  function stop() {
    const session = current.current;
    if (!session || session.finishing) return;
    setPhase('stopping');
    // stop() allows the service to deliver its last final result, but never
    // leaves recording/starting UI stuck on a missing browser end event.
    session.finishing = setTimeout(() => {
      if (current.current === session) {
        release(session);
      }
    }, 5000);
    try {
      session.recognition.stop();
    } catch {
      release(session);
    }
  }
  function start() {
    if (latest.current.disabled || !visible() || current.current) return;
    if (unavailable || !Constructor) {
      setMessage(unavailable);
      return;
    }
    cancelCurrent?.();
    setMessage('');
    let recognition: Recognition;
    try {
      recognition = new Constructor();
    } catch {
      setMessage(t('语音启动失败，请重试'));
      return;
    }
    const node = input.current!;
    const text = latest.current.value;
    const session: Session = {
      recognition,
      expected: text,
      before: text.slice(0, node.selectionStart ?? text.length),
      after: text.slice(node.selectionEnd ?? text.length),
      committed: new Map(),
      disconnect: () => undefined,
      cancel: () => undefined,
    };
    session.cancel = () => release(session);
    current.current = session;
    cancelCurrent = session.cancel;
    const allowed = () => {
      if (current.current !== session) return false;
      if (latest.current.disabled || !visible()) {
        release(session);
        return false;
      }
      return true;
    };
    recognition.lang = getLocale() === 'en' ? 'en-US' : 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      if (allowed() && !session.finishing) setPhase('listening');
    };
    recognition.onresult = (event) => {
      if (!allowed()) return;
      let dictated = '';
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript || '';
        if (result?.isFinal && !session.committed.has(index))
          session.committed.set(index, transcript);
        dictated += session.committed.get(index) ?? transcript;
      }
      // Replace this recording's insertion range on every revision, including
      // interim text. Cumulative browser results must never duplicate words.
      const text = session.before + dictated + session.after;
      const caret = session.before.length + dictated.length;
      if (text !== session.expected) {
        session.expected = text;
        // Bypass slash commands: dictated words are always an editable draft.
        latest.current.onText(text);
        requestAnimationFrame(() => {
          if (current.current === session && input.current?.value === text)
            input.current.setSelectionRange(caret, caret);
        });
      }
    };
    recognition.onerror = (event) => {
      if (!allowed()) return;
      // Permission rejection and other terminal errors already stop native
      // recognition. Only detach our session; don't reenter the native service
      // with abort() while its permission UI is being dismissed.
      release(session, { abort: false });
      if (event.error !== 'aborted' && event.error !== 'no-speech')
        setMessage(errors[event.error] || t('语音识别失败，请重试'));
    };
    recognition.onend = () => {
      if (current.current !== session) return;
      release(session, { abort: false });
    };
    const hidden = () => {
      if (!visible()) session.cancel();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        session.cancel();
      }
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', session.cancel);
    document.addEventListener('keydown', keyboard, true);
    // A side pane can stay mounted while hidden; its microphone must stop.
    const observer = new MutationObserver(hidden);
    for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement)
      observer.observe(parent, {
        attributes: true,
        attributeFilter: ['hidden', 'inert', 'class', 'style'],
      });
    const resize = new ResizeObserver(hidden);
    resize.observe(node);
    session.disconnect = () => {
      resize.disconnect();
      observer.disconnect();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', session.cancel);
      document.removeEventListener('keydown', keyboard, true);
    };
    session.deadline = setTimeout(stop, 120000);
    setPhase('starting');
    try {
      recognition.start();
    } catch {
      release(session, { abort: false });
      setMessage(t('语音启动失败，请重试'));
    }
  }
  // Typing, another draft edit, disconnect or a send state invalidates the
  // insertion position. Late results may never overwrite an edited/new draft.
  useLayoutEffect(() => {
    const session = current.current;
    if (session && (disabled || session.expected !== value)) release(session);
  }, [value, disabled]);
  useLayoutEffect(
    () => () => {
      const session = current.current;
      if (session) release(session, { update: false });
    },
    [],
  );
  return {
    phase,
    active: phase !== 'idle',
    message,
    start,
    stop,
    cancel,
  };
}
