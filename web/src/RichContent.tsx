import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { HistoryEntry } from './history';
import type { Bridge } from './transport/bridge';
import { readHistoryImage } from './media';

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        a: ({ href, children }) => (
          <a
            href={href && /^(https?:\/\/|mailto:)/i.test(href) ? href : undefined}
            target="_blank"
            rel="noreferrer noopener"
          >
            {children}
          </a>
        ),
        // Remote image URLs are not fetched from message text. Saved image content
        // must use the authorized, bounded sessions.image endpoint below.
        img: ({ alt }) => <span className="muted">{alt ? `[图片：${alt}]` : '[图片]'}</span>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function SavedImage({
  connection,
  sessionId,
  entry,
  index,
}: {
  connection?: Bridge;
  sessionId: string;
  entry: HistoryEntry;
  index: number;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(0);
  useEffect(() => {
    let active = true,
      objectUrl = '';
    if (!connection || !requested) return;
    setLoading(true);
    setError('');
    setUrl('');
    void readHistoryImage(
      connection,
      sessionId,
      entry.turnId!,
      entry.item!.id!,
      index,
      () => active,
    )
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((error) => {
        if (active) setError(String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [connection, sessionId, entry.turnId, entry.item?.id, index, requested]);
  return (
    <div className="saved-image">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt="会话历史图片" />
        </a>
      ) : (
        <button
          className="ghost"
          disabled={!connection || loading}
          onClick={() => setRequested((value) => value + 1)}
        >
          {loading ? '读取图片中…' : '读取历史图片'}
        </button>
      )}
      {error && <p className="error">{error}。历史图片不可用时请勿以当前文件替代。</p>}
    </div>
  );
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  const object = value as Record<string, unknown>;
  for (const key of ['text', 'content', 'message', 'summary', 'aggregatedOutput', 'output'])
    if (typeof object[key] === 'string' || Array.isArray(object[key])) return text(object[key]);
  return '';
}
export function RichContent({
  entry,
  connection,
  sessionId,
}: {
  entry: HistoryEntry;
  connection?: Bridge;
  sessionId: string;
}) {
  const item = entry.item || {};
  const parts = Array.isArray(item.content) ? (item.content as Record<string, unknown>[]) : [];
  const images = parts.flatMap((part, index) =>
    ['localImage', 'image'].includes(String(part.type)) ? [{ part, index }] : [],
  );
  const tool = !['userMessage', 'agentMessage', 'assistantMessage', 'reasoning'].includes(
    String(item.type),
  );
  const body = text(item);
  return (
    <div className="rich-content">
      {tool ? (
        <details>
          <summary>
            {String(item.type || '工具结果')}
            {item.status ? ` · ${String(item.status)}` : ''}
          </summary>
          <pre>{body || JSON.stringify(item, null, 2)}</pre>
        </details>
      ) : (
        <Markdown text={body} />
      )}
      {images.map(({ part, index }) =>
        part.type === 'localImage' ? (
          <SavedImage
            key={index}
            connection={connection}
            sessionId={sessionId}
            entry={entry}
            index={index}
          />
        ) : (
          <p className="muted" key={index}>
            历史远程图片暂不可读取
          </p>
        ),
      )}
      {['imageView', 'imageGeneration'].includes(String(item.type)) && (
        <SavedImage connection={connection} sessionId={sessionId} entry={entry} index={0} />
      )}
    </div>
  );
}
