import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle, MessageCircle, ChevronLeft } from 'lucide-react';
import type { Approval, Request } from '../workspace';
import type { HistoryEntry } from '../history';
import { messageQuestions, confirmedAnswers, replyText, type Question } from './question-replies';

function QuestionFields({
  questions,
  answers,
  setAnswers,
  disabled,
  onSubmit,
  canSubmit = true,
  secondary,
}: {
  questions: Question[];
  answers: Record<string, string>;
  setAnswers: (value: Record<string, string>) => void;
  disabled: boolean;
  onSubmit: () => void;
  canSubmit?: boolean;
  secondary?: ReactNode;
}) {
  const [index, setIndex] = useState(0),
    [query, setQuery] = useState('');
  const currentIndex = Math.min(index, questions.length - 1);
  const q = questions[currentIndex];
  const fields = useRef<HTMLDivElement>(null);
  const focusNext = useRef(false);
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    fields.current
      ?.querySelector<HTMLElement>('.question-options button, .question-answer')
      ?.focus();
  }, [q?.id]);
  function navigate(next: number) {
    if (disabled || next < 0 || next >= questions.length) return;
    focusNext.current = true;
    setIndex(next);
    setQuery('');
  }
  function advance() {
    if (q && answers[q.id]?.trim()) navigate(currentIndex + 1);
  }
  if (!q) return null;
  const last = currentIndex >= questions.length - 1;
  return (
    <div className="question-fields" ref={fields}>
      {questions.length > 1 && (
        <div className="question-pager" aria-live="polite">
          <span>
            {currentIndex + 1} / {questions.length}
          </span>
        </div>
      )}
      {q.header && <small>{q.header}</small>}
      <p>{q.title}</p>
      {q.options.length > 12 && (
        <input aria-label="搜索选项" value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      <div className="question-options">
        {q.options
          .filter((o) => `${o.label} ${o.description}`.toLowerCase().includes(query.toLowerCase()))
          .map((o, i) => (
            <button
              key={i}
              className={answers[q.id] === o.label ? 'selected' : ''}
              disabled={disabled}
              onClick={() => {
                setAnswers({ ...answers, [q.id]: o.label });
                navigate(currentIndex + 1);
              }}
            >
              <span className="radio-marker">{answers[q.id] === o.label ? '●' : '○'}</span>
              <span>
                {o.label}
                {o.description && <small>{o.description}</small>}
              </span>
            </button>
          ))}
      </div>
      <label>
        {q.secret ? '敏感回答' : q.options.length ? '其他回答' : '你的回答'}
        <input
          className="question-answer"
          type={q.secret ? 'password' : 'text'}
          autoComplete="off"
          value={answers[q.id] || ''}
          maxLength={16000}
          disabled={disabled}
          onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              advance();
            }
          }}
        />
      </label>
      {q.secret && <small>敏感回答仅保留在内存中。</small>}
      <div className="question-actions">
        {secondary && <div className="question-secondary">{secondary}</div>}
        {questions.length > 1 && (
          <button
            disabled={disabled || currentIndex === 0}
            onClick={() => navigate(currentIndex - 1)}
          >
            <ChevronLeft size={15} />
            上一个
          </button>
        )}
        {last ? (
          <button
            disabled={
              disabled || !canSubmit || questions.some((question) => !answers[question.id]?.trim())
            }
            onClick={onSubmit}
          >
            提交回答
          </button>
        ) : (
          <button disabled={disabled || !answers[q.id]?.trim()} onClick={advance}>
            下一个
          </button>
        )}
      </div>
    </div>
  );
}
export function ApprovalCard({
  approval,
  disabled,
  onDecide,
  onRefresh,
  uncertain,
}: {
  approval: Approval;
  disabled: boolean;
  onDecide: (
    a: Approval,
    d: string,
    answers?: Record<string, { answers: string[] }>,
  ) => Promise<void>;
  onRefresh: () => void;
  uncertain: () => boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [phase, setPhase] = useState('editing'),
    [error, setError] = useState(''),
    [confirmation, setConfirmation] = useState(false),
    [now, setNow] = useState(Date.now());
  const pending = useRef(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const expired = approval.expiresAt ? Date.parse(approval.expiresAt) <= now : false;
  const questions: Question[] = Array.isArray(approval.context?.questions)
    ? approval.context.questions.flatMap((q) =>
        q && typeof q.id === 'string'
          ? [
              {
                id: q.id,
                title: q.question || '',
                header: q.header,
                secret: q.isSecret === true,
                options: Array.isArray(q.options)
                  ? q.options.map((o: string | { label: string; description?: string }) =>
                      typeof o === 'string' ? { label: o } : o,
                    )
                  : [],
              },
            ]
          : [],
      )
    : [];
  const locked =
    disabled ||
    busy ||
    expired ||
    phase !== 'editing' ||
    !!(approval.status && approval.status !== 'pending');
  async function decide(decision: string) {
    if (
      locked ||
      pending.current ||
      (decision === 'approve' && questions.some((q) => !answers[q.id]?.trim()))
    )
      return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await onDecide(
        approval,
        decision,
        decision === 'approve' && questions.length
          ? Object.fromEntries(
              Object.entries(answers).map(([key, value]) => [key, { answers: [value] }]),
            )
          : undefined,
      );
      setPhase('sent');
      setAnswers({});
    } catch (e) {
      setError(String(e));
      if (uncertain()) setPhase('unknown');
    } finally {
      pending.current = false;
      setBusy(false);
      setConfirmation(false);
    }
  }
  return (
    <section className="approval">
      <div className="approval-copy">
        <strong>
          {phase === 'sent' ? '已处理' : questions.length ? 'Codex 需要你的回答' : '需要你的确认'}
        </strong>
        {phase === 'editing' && (
          <>
            {questions.length ? (
              <QuestionFields
                {...{ questions, answers, setAnswers }}
                disabled={locked}
                onSubmit={() => void decide('approve')}
                canSubmit={(approval.allowedDecisions || ['approve']).includes('approve')}
                secondary={
                  <button disabled={locked} onClick={() => void decide('cancel')}>
                    跳过
                  </button>
                }
              />
            ) : (
              <>
                <p>{approval.method}</p>
                <pre className="approval-context">{JSON.stringify(approval.context, null, 2)}</pre>
              </>
            )}
            {expired && <p className="muted">请求已过期。</p>}
          </>
        )}
        {phase === 'unknown' && <p>发送结果待确认，请核对会话后再操作。</p>}
        {error && <p className="error">{error}</p>}
        {confirmation && (
          <div className="confirmation">
            <p>允许这一次操作？请核对命令、目录和权限范围。</p>
            <button disabled={locked} onClick={() => void decide('approve')}>
              允许一次
            </button>
            <button onClick={() => setConfirmation(false)}>取消</button>
          </div>
        )}
      </div>
      {phase === 'editing' && !questions.length && (
        <div className="button-row">
          <button
            disabled={locked}
            onClick={() => void decide(questions.length ? 'cancel' : 'reject')}
          >
            {questions.length ? '跳过' : '拒绝'}
          </button>
          {(approval.allowedDecisions || ['approve']).includes('approve') && (
            <button
              disabled={locked || questions.some((q) => !answers[q.id]?.trim())}
              onClick={() => (questions.length ? void decide('approve') : setConfirmation(true))}
            >
              {questions.length ? '提交回答' : '检查并允许一次'}
            </button>
          )}
        </div>
      )}
      {phase === 'unknown' && (
        <button disabled={disabled} onClick={onRefresh}>
          核对会话
        </button>
      )}
    </section>
  );
}

export function AsyncQuestions({
  entry,
  history,
  request,
  receiptKey,
  disabled,
  options,
  onRefresh,
  uncertain,
}: {
  entry: HistoryEntry;
  history: HistoryEntry[];
  request: Request;
  receiptKey: string;
  disabled: boolean;
  options: Record<string, unknown>;
  onRefresh: () => void;
  uncertain: () => boolean;
}) {
  const questions = messageQuestions(entry),
    confirmed = confirmedAnswers(history, entry.item?.id || '');
  const [answers, setAnswers] = useState<Record<string, string>>({}),
    [phase, setPhase] = useState(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(receiptKey) || 'null');
        return saved?.phase === 'sent' || !saved ? 'editing' : 'unknown';
      } catch {
        return 'unavailable';
      }
    }),
    [submitted, setSubmitted] = useState<string[]>(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(receiptKey) || 'null');
        return saved?.phase === 'sent' && Array.isArray(saved.ids)
          ? saved.ids.filter((id: unknown) => typeof id === 'string')
          : Array.isArray(saved?.submittedIds)
            ? saved.submittedIds.filter((id: unknown) => typeof id === 'string')
            : [];
      } catch {
        return [];
      }
    }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [pendingIds, setPendingIds] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(receiptKey) || 'null');
      return saved?.phase === 'pending' &&
        Array.isArray(saved.ids) &&
        saved.ids.every((id: unknown) => typeof id === 'string')
        ? saved.ids
        : [];
    } catch {
      return [];
    }
  });
  const pending = useRef(false);
  if (!questions.length) return null;
  const done = new Set([...confirmed, ...submitted]),
    remaining = questions.filter((q) => !done.has(q.id));
  const allSent = !remaining.length,
    reconciled =
      phase === 'unknown' && pendingIds.length > 0 && pendingIds.every((id) => confirmed.has(id)),
    locked = disabled || busy || (!allSent && phase !== 'editing' && !reconciled);
  async function submit() {
    if (locked || pending.current || remaining.some((q) => !answers[q.id]?.trim())) return;
    const provided = Object.fromEntries(
      Object.entries(answers).filter(([id, value]) => !done.has(id) && value.trim()),
    );
    if (!Object.keys(provided).length) return;
    pending.current = true;
    setBusy(true);
    setError('');
    let accepted = false;
    try {
      const text = replyText(entry, provided);
      setPendingIds(Object.keys(provided));
      localStorage.setItem(
        receiptKey,
        JSON.stringify({ phase: 'pending', ids: Object.keys(provided), submittedIds: [...done] }),
      );
      const sessionId = options.sessionId;
      const active = await request<{ sessionId: string; upstreamTurnId: string | null }>(
        'turn.active',
        { sessionId },
      );
      if (active.sessionId !== sessionId || !('upstreamTurnId' in active))
        throw new Error('会话身份不匹配');
      if (active.upstreamTurnId) {
        const result = await request<{
          accepted?: boolean;
          sessionId?: string;
          upstreamTurnId?: string;
        }>('turn.steer', { sessionId, expectedTurnId: active.upstreamTurnId, text });
        accepted = true;
        if (
          result.accepted !== true ||
          result.sessionId !== sessionId ||
          result.upstreamTurnId !== active.upstreamTurnId
        )
          throw new Error('回答受理结果需要核对');
      } else {
        const result = await request<{ turn?: { sessionId?: string } }>('turn.start', {
          ...options,
          text,
        });
        accepted = true;
        if (result.turn?.sessionId !== sessionId) throw new Error('回答受理结果需要核对');
      }
      const ids = [...new Set([...done, ...Object.keys(provided)])];
      localStorage.setItem(receiptKey, JSON.stringify({ phase: 'sent', ids }));
      setSubmitted(ids);
      setAnswers({});
      setPhase('editing');
      onRefresh();
    } catch (e) {
      setError(String(e));
      if (accepted || uncertain()) setPhase('unknown');
      else {
        try {
          if (done.size)
            localStorage.setItem(receiptKey, JSON.stringify({ phase: 'sent', ids: [...done] }));
          else localStorage.removeItem(receiptKey);
          setPhase('editing');
        } catch {
          setPhase('unknown');
        }
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="async-questions">
      <div className="questions-heading">
        {allSent ? <CheckCircle size={18} /> : <MessageCircle size={18} />}
        <strong>{allSent ? '已回答 Codex 的问题' : 'Codex 需要你的回答'}</strong>
        <small>
          {allSent
            ? '已提交'
            : busy
              ? '发送中…'
              : phase === 'unknown' && !reconciled
                ? '等待确认'
                : `${done.size + remaining.filter((q) => answers[q.id]?.trim()).length} / ${questions.length}`}
        </small>
      </div>
      {!allSent && (
        <>
          <QuestionFields
            questions={remaining}
            {...{ answers, setAnswers }}
            disabled={locked}
            onSubmit={() => void submit()}
            secondary={
              phase !== 'editing' && (
                <button disabled={disabled} onClick={onRefresh}>
                  核对会话
                </button>
              )
            }
          />
        </>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
