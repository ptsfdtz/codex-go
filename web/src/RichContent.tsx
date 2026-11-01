import { errorText, t, useLocale } from './i18n';
import { useEffect, useState, type ReactNode } from 'react';
import { deferred } from './deferred';
import type { HistoryEntry } from './history';
import type { Bridge } from './transport/bridge';
import { readHistoryImage } from './media';
import { ImagePreview } from './features/message-images/ImagePreview';
import {
  Terminal,
  FileDiff,
  FileText,
  Globe,
  Wrench,
  Image,
  ListChecks,
  Brain,
  ChevronRight,
  Users,
  Minimize2,
} from 'lucide-react';
import { type MessageImageSource } from './features/message-images/MessageImage';
import { DiffText } from './features/DiffText';
import { displayCommand } from './features/command-display';

export const Markdown = deferred<Parameters<typeof import('./Markdown').Markdown>[0]>(
  () => import('./Markdown').then((module) => ({ default: module.Markdown })),
  ({ text }) => <div className="markdown-pending">{text}</div>,
);

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
  useLocale();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [requested, setRequested] = useState(1);
  useEffect(() => {
    let active = true,
      objectUrl = '';
    setLoading(!!connection);
    setError('');
    setUrl('');
    if (!connection || !requested) return;
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
        <ImagePreview key={url} src={url} alt={t('会话历史图片')} />
      ) : error ? (
        <button
          className="ghost"
          disabled={!connection || loading}
          onClick={() => setRequested((value) => value + 1)}
        >
          {t('重试读取图片')}
        </button>
      ) : (
        <p className="muted" role="status">
          {connection ? t('读取图片中…') : t('连接电脑后读取图片')}
        </p>
      )}
      {error && (
        <p className="error">
          {t('图片暂不可用：')}
          {errorText(error)}
        </p>
      )}
    </div>
  );
}

function ImageDisclosure({ children }: { children: ReactNode }) {
  useLocale();
  const [open, setOpen] = useState(false);
  return (
    <details className="tool-record" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <Image size={16} />
        <span>{t('图片')}</span>
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
  if (fileReferencePart(object)) return '';
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
  images: projectImages,
  sessionImages = false,
}: {
  entry: HistoryEntry;
  connection?: Bridge;
  sessionId: string;
  onFile?: (path: string) => void;
  onAgent?: (id: string) => void;
  images?: MessageImageSource;
  sessionImages?: boolean;
}) {
  useLocale();
  const item = entry.item || {};
  const messageImages: MessageImageSource | undefined =
    sessionImages &&
    connection &&
    sessionId &&
    entry.turnId &&
    item.id &&
    ['agentMessage', 'assistantMessage'].includes(String(item.type))
      ? {
          request: connection.request.bind(connection),
          projectId: '',
          root: '',
          session: { connection, sessionId, turnId: entry.turnId, itemId: String(item.id) },
        }
      : projectImages;

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
          {t('历史远程图片暂不可读取')}
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
            <span>{t('Thinking')}</span>
            <ChevronRight size={14} />
          </summary>
          <Markdown text={body} onFile={onFile} images={messageImages} />
        </details>
      ) : item.type === 'plan' ? (
        <div className="plan-content">
          <div className="plan-heading">
            <ListChecks size={17} />
            {t('计划')}
          </div>
          <Markdown text={body} onFile={onFile} images={messageImages} />
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
        </div>
      ) : (
        <Markdown text={body} onFile={onFile} images={messageImages} />
      )}
      {!tool && <FileReferences parts={parts} onFile={onFile} />}
      {!tool && imageContent && <ImageDisclosure>{imageContent}</ImageDisclosure>}
    </div>
  );
}

export function fileReferencePart(value: unknown): { name: string; path: string } | undefined {
  if (!value || typeof value !== 'object') return;
  const part = value as {
    type?: string;
    text?: string;
    text_elements?: { byteRange?: { start?: number; end?: number }; placeholder?: string }[];
  };
  const text = part.text;
  if (part.type !== 'text' || typeof text !== 'string' || !/^(?:\/|[A-Za-z]:[\\/])/.test(text))
    return;
  const elements = part.text_elements;
  const name = elements?.[0]?.placeholder?.startsWith('@') ? elements[0].placeholder.slice(1) : '';
  if (
    name &&
    Array.isArray(elements) &&
    elements.length === 1 &&
    elements[0]?.byteRange?.start === 0 &&
    elements[0]?.byteRange?.end === new TextEncoder().encode(text).length
  )
    return { name, path: text };
}
export function FileReferences({
  parts,
  onFile,
}: {
  parts: unknown[];
  onFile?: (path: string) => void;
}) {
  useLocale();
  const references = parts.flatMap((value, index) => {
    const reference = fileReferencePart(value);
    return reference ? [{ ...reference, index }] : [];
  });
  if (!references.length) return null;

  return (
    <div className="file-references">
      {references.map((reference) => (
        <button
          className="resource-chip file-reference-chip"
          key={reference.index}
          title={reference.path}
          disabled={!onFile}
          onClick={() => onFile?.(reference.path)}
        >
          <FileText size={14} />
          <span>{reference.name}</span>
        </button>
      ))}
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
  useLocale();
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
        commandExecution: t('Ran command'),
        fileChange: t('Edited files'),
        webSearch: t('Searched the web'),
        mcpToolCall: t('tool.used', {
          server: item.server || t('tool.fallback'),
          tool: item.tool ? ` · ${item.tool}` : '',
        }),
        imageView: t('Viewed image'),
        imageGeneration: t('Generated image'),
        collabAgentToolCall: t('Agent activity'),
        contextCompaction: t('Compacted context'),
      } as Record<string, string>
    )[type] ||
    type ||
    t('Activity');
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
            <div className="tool-meta">
              {typeof item.cwd === 'string' && <span>{item.cwd}</span>}
              {item.exitCode !== undefined && item.exitCode !== null && (
                <span>
                  {t('Exit ')}
                  {String(item.exitCode)}
                </span>
              )}
              {item.durationMs !== undefined && (
                <span>
                  {String(item.durationMs)} {t(' ms')}
                </span>
              )}
              {item.processId !== undefined && (
                <span>
                  {t('Process ')}
                  {String(item.processId)}
                </span>
              )}
            </div>
          </>
        )}
        {type === 'fileChange' && changes.length ? (
          changes.map((change, index) => (
            <div key={index}>
              <strong>{change.path}</strong>
              {onFile && change.path && (
                <button className="text-button" onClick={() => onFile(change.path!)}>
                  {t('Preview current file')}
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
              {t('Open agent conversation')}
            </button>
          ))}
        {text.length > 16000 && (
          <button className="text-button" onClick={() => setFull(!full)}>
            {full ? t('收起') : t('读取完整输出')}
          </button>
        )}
        {type === 'mcpToolCall' && (
          <details className="technical-details">
            <summary>{t('Arguments and result')}</summary>
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
