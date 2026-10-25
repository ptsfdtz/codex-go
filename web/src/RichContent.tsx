import { useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { HistoryEntry } from './history';
import type { Bridge } from './transport/bridge';
import { readHistoryImage } from './media';
import {
  Terminal,
  FileDiff,
  Globe,
  Wrench,
  Image,
  ListChecks,
  Brain,
  ChevronRight,
  Users,
  Minimize2,
} from 'lucide-react';
import { DiffText } from './features/DiffText';
import { displayCommand } from './features/command-display';

export function Markdown({ text, onFile }: { text: string; onFile?: (path: string) => void }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={(url) => url}
      components={{
        a: ({ href, children }) =>
          href && /^(https?:\/\/|mailto:)/i.test(href) ? (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ) : href &&
            onFile &&
            (!/^[a-z][a-z0-9+.-]*:/i.test(href) || /^(?:file:|[a-z]:[\\/])/i.test(href)) ? (
            <button className="file-link" onClick={() => onFile(href)}>
              {children}
            </button>
          ) : (
            <span>{children}</span>
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
  const [loading, setLoading] = useState(true);
  const [requested, setRequested] = useState(1);
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
      ) : error ? (
        <button
          className="ghost"
          disabled={!connection || loading}
          onClick={() => setRequested((value) => value + 1)}
        >
          重试读取图片
        </button>
      ) : (
        <p className="muted" role="status">
          {connection ? '读取图片中…' : '连接电脑后读取图片'}
        </p>
      )}
      {error && <p className="error">{error}。历史图片不可用时请勿以当前文件替代。</p>}
    </div>
  );
}

function ImageDisclosure({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="tool-record" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <Image size={16} />
        <span>图片</span>
        <ChevronRight size={14} />
      </summary>
      {open && <div className="tool-body">{children}</div>}
    </details>
  );
}

export function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  const object = value as Record<string, unknown>;
  for (const key of [
    'text',
    'content',
    'message',
    'summary',
    'aggregatedOutput',
    'output',
    'review',
  ])
    if (typeof object[key] === 'string' || Array.isArray(object[key])) {
      const result = contentText(object[key]);
      if (result) return result;
    }
  return '';
}
export function questionAnswers(body: string): { question: string; answer: string }[] | undefined {
  const match =
    /^\s*<send_user_message_question_reply>\s*([\s\S]+?)\s*<\/send_user_message_question_reply>\s*$/.exec(
      body,
    );
  if (!match) return;
  try {
    const values: unknown = JSON.parse(match[1]!);
    if (
      Array.isArray(values) &&
      values.length &&
      values.every(
        (value) => typeof value?.question === 'string' && typeof value?.answer === 'string',
      )
    )
      return values.map(({ question, answer }) => ({ question, answer }));
  } catch {
    /* Malformed wrappers remain visible as their original text. */
  }
}
export function RichContent({
  entry,
  connection,
  sessionId,
  onFile,
  onAgent,
  onImplementPlan,
  onRevisePlan,
  planDisabled,
}: {
  entry: HistoryEntry;
  connection?: Bridge;
  sessionId: string;
  onFile?: (path: string) => void;
  onAgent?: (id: string) => void;
  onImplementPlan?: () => void;
  onRevisePlan?: () => void;
  planDisabled?: boolean;
}) {
  const item = entry.item || {};
  const parts = Array.isArray(item.content) ? (item.content as Record<string, unknown>[]) : [];
  const images = parts.flatMap((part, index) =>
    ['localImage', 'image'].includes(String(part.type)) ? [{ part, index }] : [],
  );
  const tool =
    !['userMessage', 'agentMessage', 'assistantMessage', 'reasoning', 'plan'].includes(
      String(item.type),
    ) && !['user', 'assistant'].includes(String(item.role));
  const body = contentText(item);
  const answers = item.type === 'userMessage' ? questionAnswers(body) : undefined;
  const imageContent = images.length ? (
    images.map(({ part, index }) =>
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
    )
  ) : ['imageView', 'imageGeneration'].includes(String(item.type)) ? (
    <SavedImage connection={connection} sessionId={sessionId} entry={entry} index={0} />
  ) : null;
  return (
    <div className="rich-content">
      {tool ? (
        <ToolContent item={item} body={body} onFile={onFile} onAgent={onAgent}>
          {imageContent}
        </ToolContent>
      ) : answers ? (
        answers.map((answer, index) => (
          <blockquote key={index}>
            <p>{answer.question}</p>
            <p>{answer.answer}</p>
          </blockquote>
        ))
      ) : item.type === 'reasoning' ? (
        <details className="tool-record reasoning">
          <summary>
            <Brain size={16} />
            <span>Thinking</span>
            <ChevronRight size={14} />
          </summary>
          <Markdown text={body} onFile={onFile} />
        </details>
      ) : item.type === 'plan' ? (
        <div className="plan-content">
          <div className="plan-heading">
            <ListChecks size={17} />
            计划
          </div>
          <Markdown text={body} onFile={onFile} />
          {Array.isArray(item.plan) && (
            <ul className="plan-steps">
              {(item.plan as { step?: string; status?: string }[]).map((step, index) => (
                <li key={index}>
                  {step.status === 'completed' ? '✓ ' : '○ '}
                  {step.step}
                </li>
              ))}
            </ul>
          )}
          {onImplementPlan && (
            <div className="plan-confirmation">
              <p>是否按照此计划开发？</p>
              <div className="button-row">
                <button disabled={planDisabled} onClick={onImplementPlan}>
                  按照计划开发
                </button>
                <button disabled={planDisabled} onClick={onRevisePlan}>
                  继续调整计划
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <Markdown text={body} onFile={onFile} />
      )}
      {!tool && imageContent && <ImageDisclosure>{imageContent}</ImageDisclosure>}
    </div>
  );
}

function ToolContent({
  item,
  body,
  onFile,
  onAgent,
  children,
}: {
  item: Record<string, unknown>;
  body: string;
  onFile?: (s: string) => void;
  onAgent?: (s: string) => void;
  children?: ReactNode;
}) {
  const [full, setFull] = useState(false);
  const [open, setOpen] = useState(false);
  const type = String(item.type || '');
  const rawCommand = String(item.command || '');
  const command = type === 'commandExecution' ? displayCommand(rawCommand) : '';
  const Icon =
    (
      {
        commandExecution: Terminal,
        fileChange: FileDiff,
        webSearch: Globe,
        mcpToolCall: Wrench,
        imageView: Image,
        imageGeneration: Image,
        collabAgentToolCall: Users,
        contextCompaction: Minimize2,
      } as Record<string, typeof Terminal>
    )[type] || Wrench;
  const label =
    (
      {
        commandExecution: 'Ran command',
        fileChange: 'Edited files',
        webSearch: 'Searched the web',
        mcpToolCall: `Used ${item.server || 'tool'}${item.tool ? ` · ${item.tool}` : ''}`,
        imageView: 'Viewed image',
        imageGeneration: 'Generated image',
        collabAgentToolCall: 'Agent activity',
        contextCompaction: 'Compacted context',
      } as Record<string, string>
    )[type] ||
    type ||
    'Activity';
  const preview =
    type === 'commandExecution'
      ? command.replace(/\s+/g, ' ')
      : type === 'webSearch'
        ? String(item.query || '')
        : '';
  const changes = Array.isArray(item.changes)
    ? (item.changes as { path?: string; kind?: unknown; diff?: string }[])
    : [];
  const text = type === 'commandExecution' ? body : body || JSON.stringify(item, null, 2);
  return (
    <details
      className="tool-record"
      onToggle={(event) => {
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        <Icon size={16} />
        <span>
          {label}
          {preview && <span className="tool-preview">{preview}</span>}
        </span>
        {item.status === 'inProgress' && <span className="activity-dot" />}
        <ChevronRight size={14} />
      </summary>
      <div className="tool-body">
        {open && children}
        {type === 'commandExecution' && (
          <>
            <pre className="command">{command}</pre>
            {command !== rawCommand.trim() && (
              <details className="technical-details original-command">
                <summary>Original command</summary>
                <pre>{rawCommand}</pre>
              </details>
            )}
            <div className="tool-meta">
              {typeof item.cwd === 'string' && <span>{item.cwd}</span>}
              {item.exitCode !== undefined && item.exitCode !== null && (
                <span>Exit {String(item.exitCode)}</span>
              )}
              {item.durationMs !== undefined && <span>{String(item.durationMs)} ms</span>}
              {item.processId !== undefined && <span>Process {String(item.processId)}</span>}
            </div>
          </>
        )}
        {type === 'fileChange' && changes.length ? (
          changes.map((change, index) => (
            <div key={index}>
              <strong>{change.path}</strong>
              {onFile && change.path && (
                <button className="text-button" onClick={() => onFile(change.path!)}>
                  Preview current file
                </button>
              )}
              {change.diff && <DiffText text={change.diff} />}
            </div>
          ))
        ) : text ? (
          <pre>{full ? text : text.slice(0, 16000)}</pre>
        ) : null}
        {onAgent &&
          [
            ...new Set(
              [
                item.agentThreadId,
                ...(Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : []),
              ].filter((id): id is string => typeof id === 'string'),
            ),
          ].map((id) => (
            <button key={id} className="text-button" onClick={() => onAgent(id)}>
              Open agent conversation
            </button>
          ))}
        {text.length > 16000 && (
          <button className="text-button" onClick={() => setFull(!full)}>
            {full ? '收起' : '读取完整输出'}
          </button>
        )}
        {type === 'mcpToolCall' && (
          <details className="technical-details">
            <summary>Arguments and result</summary>
            <pre>
              {JSON.stringify(
                { arguments: item.arguments, result: item.result, error: item.error },
                null,
                2,
              )}
            </pre>
          </details>
        )}
      </div>
    </details>
  );
}
