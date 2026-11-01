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
  start: number;
  end: number;
  committed: Set<number>;
  received: boolean;
  deadline?: ReturnType<typeof setTimeout>;
  finishing?: ReturnType<typeof setTimeout>;
  disconnect: () => void;
  cancel: () => void;
};

// One microphone per page, including main chat, side chat and AgentChat.
let cancelCurrent: (() => void) | undefined;
const description = () => t('使用浏览器语音服务，可能需要联网；识别文字加入草稿，核对后手动发送。');
const errors: Record<string, string> = {
  get 'not-allowed'() {
    return t(
      '麦克风或语音识别权限未获允许，请在浏览器的网站设置中检查权限。也可使用系统键盘听写。',
    );
  },
  get 'service-not-allowed'() {
    return t('浏览器未允许语音识别服务，请使用系统键盘听写或更换支持语音识别的浏览器。');
  },
  get 'audio-capture'() {
    return t('无法使用麦克风，请检查设备是否可用、是否被其他应用占用。');
  },
  get network() {
    return t('语音识别服务连接失败，请检查网络，或使用系统键盘听写。');
  },
  get 'no-speech'() {
    return t('未识别到语音，请靠近麦克风后重试。');
  },
  get 'language-not-supported'() {
    return t('浏览器的语音服务暂不支持普通话，请使用系统键盘听写。');
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
  const [interim, setInterim] = useState('');
  const [message, setMessage] = useState('');
  const current = useRef<Session>(undefined);
  const latest = useRef({ value, disabled, onText });
  latest.current = { value, disabled, onText };
  const Constructor =
    (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
  const unavailable = !window.isSecureContext
    ? t('语音输入需要 HTTPS 或本机开发页面。也可使用系统键盘听写。')
    : !Constructor
      ? t('当前浏览器未提供网页语音识别，请使用系统键盘的麦克风听写，或更换支持语音识别的浏览器。')
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
  function release(session: Session, update = true) {
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
    try {
      recognition.abort();
    } catch {
      /* Some engines throw after ending. */
    }
    if (update) {
      setPhase('idle');
      setInterim('');
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
        setMessage(t('语音识别已结束，未确认的片段已舍弃；请核对草稿。'));
      }
    }, 5000);
    try {
      session.recognition.stop();
    } catch {
      release(session);
      setMessage(t('语音输入已停止，请核对草稿。'));
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
    setInterim('');
    let recognition: Recognition;
    try {
      recognition = new Constructor();
    } catch {
      setMessage(t('浏览器无法启动语音识别，请使用系统键盘听写。'));
      return;
    }
    const node = input.current!;
    const text = latest.current.value;
    const session: Session = {
      recognition,
      expected: text,
      start: node.selectionStart ?? text.length,
      end: node.selectionEnd ?? text.length,
      committed: new Set(),
      received: false,
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
      let preview = '';
      let text = session.expected;
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript || '';
        if (!result?.isFinal) {
          preview += transcript;
          continue;
        }
        if (session.committed.has(index)) continue;
        session.committed.add(index);
        if (!transcript) continue;
        text = text.slice(0, session.start) + transcript + text.slice(session.end);
        session.start += transcript.length;
        session.end = session.start;
        session.received = true;
      }
      if (text !== session.expected) {
        session.expected = text;
        // Bypass slash commands: dictated words are always an editable draft.
        latest.current.onText(text);
        requestAnimationFrame(() => {
          if (current.current === session && input.current?.value === text)
            input.current.setSelectionRange(session.start, session.start);
        });
      }
      setInterim(preview.slice(0, 12000));
    };
    recognition.onerror = (event) => {
      if (!allowed()) return;
      release(session);
      if (event.error !== 'aborted')
        setMessage(
          errors[event.error] || t('语音识别未完成，请核对草稿后重试或使用系统键盘听写。'),
        );
    };
    recognition.onend = () => {
      if (current.current !== session) return;
      release(session);
      if (!session.received) setMessage(t('未得到确认的识别文字，请重试或使用系统键盘听写。'));
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
      release(session);
      setMessage(t('语音识别启动失败，请检查麦克风权限或使用系统键盘听写。'));
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
      if (session) release(session, false);
    },
    [],
  );
  return {
    phase,
    active: phase !== 'idle',
    interim,
    message,
    description: description(),
    unavailable,
    start,
    stop,
    cancel,
    dismiss: () => setMessage(''),
  };
}
