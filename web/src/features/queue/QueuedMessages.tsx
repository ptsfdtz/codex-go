import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Trash2, Clock, RefreshCw, Paperclip } from 'lucide-react';
import { IconButton } from '../../ui';
import { contentText, FileReferences } from '../../RichContent';
import type { Request } from '../../workspace';

export type QueuedMessage = {
  id: string;
  input: unknown[];
  inputRevision?: string;
  status?: string;
  deliveryState?: string;
  deliveryMessage?: string;
};
export function QueuedMessages({
  request,
  sessionId,
  revision,
  enabled,
  disabled,
  active,
  canStart,
  canSteer,
  uncertain,
  onChanged,
}: {
  request: Request;
  sessionId: string;
  revision: number;
  enabled: boolean;
  disabled: boolean;
  active: boolean;
  canStart: boolean;
  canSteer: boolean;
  uncertain: () => boolean;
  onChanged: () => void;
}) {
  const [entries, setEntries] = useState<QueuedMessage[]>([]),
    [error, setError] = useState('');
  const [readError, setReadError] = useState(''),
    [fresh, setFresh] = useState(false);
  const source = useRef(request);
  source.current = request;
  const [loading, setLoading] = useState(false),
    [pending, setPending] = useState('');
  const [reload, setReload] = useState(0),
    [expanded, setExpanded] = useState<string[]>([]);
  const alive = useRef(true),
    lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const wake = () => {
      if (document.visibilityState === 'visible') setReload((value) => value + 1);
    };
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [enabled]);
  useEffect(() => {
    if (!enabled) {
      setEntries([]);
      setError('');
      setFresh(false);
      return;
    }
    let current = true;
    setLoading(true);
    setFresh(false);
    // Coalesce bursts of queue events and local mutation acknowledgements.
    const timer = window.setTimeout(() => {
      void request<{ sessionId: string; data: QueuedMessage[] }>('queue.list', { sessionId })
        .then((value) => {
          if (!current) return;
          if (value.sessionId !== sessionId || !Array.isArray(value.data))
            throw new Error('队列会话身份不匹配');
          setEntries(value.data);
          setReadError('');
          setFresh(true);
        })
        .catch((error) => {
          if (current) setReadError(String(error));
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 100);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [request, sessionId, enabled, revision, reload]);
  async function mutate(kind: 'delete' | 'send', entry: QueuedMessage) {
    if (lock.current || disabled || loading || !fresh || uncertain()) return;
    const origin = request;
    lock.current = true;
    setPending(entry.id);
    setError('');
    try {
      if (kind === 'delete') await request('queue.delete', { sessionId, submissionId: entry.id });
      else if (active) {
        const turn = await request<{ sessionId: string; upstreamTurnId?: string }>('turn.active', {
          sessionId,
        });
        if (!alive.current || source.current !== origin) return;
        if (turn.sessionId !== sessionId || !turn.upstreamTurnId)
          throw new Error('当前任务已变化，请刷新队列后重试');
        await request('queue.steer', {
          sessionId,
          submissionId: entry.id,
          expectedTurnId: turn.upstreamTurnId,
          expectedInputRevision: entry.inputRevision,
        });
      } else await request('queue.start', { sessionId, submissionId: entry.id });
      if (alive.current && source.current === origin) {
        setReload((value) => value + 1);
        onChanged();
      }
    } catch (error) {
      if (alive.current && source.current === origin) {
        setError(uncertain() ? '操作结果待确认，请核对队列和会话，勿重复发送。' : String(error));
        setReload((value) => value + 1);
      }
    } finally {
      lock.current = false;
      if (alive.current) setPending('');
    }
  }
  if (!enabled || (!entries.length && !error && !readError)) return null;
  return (
    <section className="queued-messages" aria-label="待发送消息" aria-busy={loading || !!pending}>
      <div className="queued-heading">
        <span>
          <Clock size={13} />
          待发送 <small>{entries.length}</small>
        </span>
        <IconButton
          icon={RefreshCw}
          label="刷新待发送消息"
          disabled={!!pending || loading}
          onClick={() => setReload((value) => value + 1)}
        />
      </div>
      <div className="queued-list">
        {entries.map((entry) => {
          const text = contentText(entry.input),
            resources = entry.input.some(
              (part) =>
                !!part &&
                typeof part === 'object' &&
                ((part as { type?: string }).type !== 'text' ||
                  !!(part as { text_elements?: unknown[] }).text_elements?.length),
            );
          const reason = entry.deliveryState
            ? entry.deliveryMessage || '请先核对会话，再删除这条记录'
            : active && !canSteer
              ? '升级 Host 后可补充到当前任务'
              : active && resources
                ? '含资源的消息保留在队列中，任务空闲后可提前发送'
                : !active && !canStart
                  ? '当前电脑不支持提前发送'
                  : '';
          return (
            <div className="queued-message" key={entry.id}>
              <div className="queued-content">
                <button
                  className={`queued-text${expanded.includes(entry.id) ? ' is-expanded' : ''}`}
                  aria-expanded={expanded.includes(entry.id)}
                  onClick={() =>
                    setExpanded((values) =>
                      values.includes(entry.id)
                        ? values.filter((id) => id !== entry.id)
                        : [...values, entry.id],
                    )
                  }
                >
                  {text || '资源消息'}
                </button>
                {expanded.includes(entry.id) && <FileReferences parts={entry.input} />}
                {entry.deliveryState && <small className="queued-reason">{reason}</small>}
              </div>
              <div className="queued-actions">
                {resources && (
                  <span
                    className="queued-resource"
                    title="包含附件、技能或引用"
                    aria-label="包含附件、技能或引用"
                    role="img"
                  >
                    <Paperclip size={14} />
                  </span>
                )}
                <span
                  title={reason || (active ? '补充到当前任务，不停止运行' : '立即发送这条消息')}
                  tabIndex={reason ? 0 : undefined}
                  aria-label={reason || undefined}
                >
                  <IconButton
                    icon={ArrowUp}
                    label={`提前发送消息 ${entry.id}`}
                    disabled={disabled || loading || !fresh || !!pending || !!reason}
                    onClick={() => void mutate('send', entry)}
                  />
                </span>
                <IconButton
                  icon={Trash2}
                  label={`删除待发送消息 ${entry.id}`}
                  disabled={disabled || loading || !fresh || !!pending}
                  onClick={() => void mutate('delete', entry)}
                />
              </div>
            </div>
          );
        })}
      </div>
      {(error || readError) && (
        <p className="queued-error" role="alert">
          {error || readError}
        </p>
      )}
    </section>
  );
}
