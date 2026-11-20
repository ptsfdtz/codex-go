import { t, useLocale, getLocale } from '../../i18n';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { IconButton } from '../../ui';
import { diffLines } from './workspace-state';

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export type ScrollPosition = { top: number; left: number };

export type DiffReview = {
  target: string;
  add: (comment: string) => void;
  base?: string;
  head?: string;
};

export function CodePreview({
  text,
  path,
  diff = false,
  review,
  diffLabel = t('工作区差异'),
  untracked = false,
  position,
  onScroll,
  findToken,
}: {
  findToken?: number;
  text: string;
  path: string;
  diff?: boolean;
  review?: DiffReview;
  diffLabel?: string;
  untracked?: boolean;
  position?: ScrollPosition;
  onScroll: (position: ScrollPosition) => void;
}) {
  useLocale();
  const rowHeight = review && diff && window.matchMedia('(pointer:coarse)').matches ? 44 : 22;
  const viewport = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [height, setHeight] = useState(500),
    [top, setTop] = useState(position?.top || 0);
  const [highlighted, setHighlighted] = useState<{
    source: string;
    path: string;
    lines: string[];
  }>();
  const [find, setFind] = useState(false),
    [query, setQuery] = useState(''),
    [match, setMatch] = useState(0);
  const raw = useMemo(() => text.replace(/\r\n/g, '\n').split('\n'), [text]);
  const changes = useMemo(() => (diff ? diffLines(text, untracked) : []), [text, diff, untracked]);
  const html = useMemo(
    () =>
      highlighted?.source === text && highlighted.path === path
        ? highlighted.lines
        : raw.map(escape),
    [highlighted, raw, text, path],
  );
  const matches = useMemo(
    () =>
      query
        ? raw.flatMap((line, i) => (line.toLowerCase().includes(query.toLowerCase()) ? [i] : []))
        : [],
    [query, raw],
  );
  const selected = matches[Math.min(match, matches.length - 1)];
  const matchingLines = useMemo(() => new Set(matches), [matches]);
  const columns = useMemo(
    () => raw.reduce((n, line) => Math.max(n, line.replace(/\t/g, '    ').length), 0),
    [raw],
  );
  useEffect(() => {
    if (diff) return;
    let active = true;
    void import('./highlight')
      .then(({ highlightLines }) => {
        if (active) setHighlighted({ source: text, path, lines: highlightLines(text, path).lines });
      })
      .catch(() => {
        /* A plain text preview remains usable if highlighting cannot load. */
      });
    return () => {
      active = false;
    };
  }, [text, path, diff]);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    node.scrollTop = position?.top || 0;
    node.scrollLeft = position?.left || 0;
    const observer = new ResizeObserver(() => setHeight(node.clientHeight));
    observer.observe(node);
    return () => observer.disconnect();
    // A file view is keyed by its path and mode; restore its position only on mount.
  }, []);
  const previousFindToken = useRef(findToken);
  useEffect(() => {
    if (findToken === previousFindToken.current) return;
    previousFindToken.current = findToken;
    setFind(true);
    requestAnimationFrame(() => search.current?.focus());
  }, [findToken]);
  function showFind() {
    setFind(true);
    requestAnimationFrame(() => search.current?.focus());
  }
  function goTo(index: number) {
    if (!matches.length) return;
    const next = (index + matches.length) % matches.length;
    setMatch(next);
    viewport.current?.scrollTo({ top: Math.max(0, matches[next]! * rowHeight - height / 3) });
  }
  const [anchor, setAnchor] = useState<{
    target: string;
    path: string;
    location: string;
    original: string;
    base?: string;
    head?: string;
  }>();
  const [opinion, setOpinion] = useState('');
  const count = diff ? changes.length : raw.length;
  const start = Math.max(0, Math.floor(top / rowHeight) - 12),
    end = Math.min(count, Math.ceil((top + height) / rowHeight) + 12);
  return (
    <div
      className="file-code"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault();
          showFind();
        }
      }}
    >
      {findToken === undefined && (
        <div className="file-code-toolbar">
          <span>
            {diff ? diffLabel : t('{{p0}} 行', { p0: raw.length.toLocaleString(getLocale()) })}
          </span>
          <IconButton icon={Search} label={t('文件内查找')} onClick={showFind} />
        </div>
      )}
      {anchor && review && anchor.target === review.target && anchor.path === path && (
        <form
          className="diff-review-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!opinion.trim()) return;
            const revision =
              anchor.base && anchor.head ? ' (' + anchor.base + ' → ' + anchor.head + ')' : '';
            review.add(
              anchor.path +
                ' · ' +
                anchor.location +
                revision +
                '\n' +
                anchor.original +
                '\n' +
                opinion.trim(),
            );
            setAnchor(undefined);
            setOpinion('');
          }}
        >
          <label>
            {anchor.path} · {anchor.location}
            <textarea
              autoFocus
              aria-label={t('行级意见')}
              value={opinion}
              onChange={(e) => setOpinion(e.target.value)}
            />
          </label>
          <code>{anchor.original}</code>
          <div>
            <button type="submit" disabled={!opinion.trim()}>
              {t('加入当前草稿')}
            </button>
            <button type="button" onClick={() => setAnchor(undefined)}>
              {t('取消')}
            </button>
          </div>
        </form>
      )}
      {find && (
        <form
          className="file-find"
          onSubmit={(event) => {
            event.preventDefault();
            goTo(match + 1);
          }}
        >
          <input
            ref={search}
            aria-label={t('文件内查找')}
            placeholder={t('查找文本')}
            value={query}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              setMatch(0);
              const index = value
                ? raw.findIndex((line) => line.toLowerCase().includes(value.toLowerCase()))
                : -1;
              if (index >= 0)
                viewport.current?.scrollTo({ top: Math.max(0, index * rowHeight - height / 3) });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setFind(false);
                viewport.current?.focus();
              }
            }}
          />
          <span aria-live="polite">
            {matches.length
              ? `${Math.min(match + 1, matches.length)} / ${matches.length}`
              : '0 / 0'}
          </span>
          <IconButton
            icon={ChevronUp}
            label={t('上一个匹配')}
            disabled={!matches.length}
            onClick={() => goTo(match - 1)}
          />
          <IconButton
            icon={ChevronDown}
            label={t('下一个匹配')}
            disabled={!matches.length}
            onClick={() => goTo(match + 1)}
          />
          <IconButton icon={X} label={t('关闭文件查找')} onClick={() => setFind(false)} />
        </form>
      )}
      <div
        className="file-code-scroll"
        ref={viewport}
        tabIndex={0}
        aria-label={diff ? t('{{p0}} 的差异', { p0: path }) : t('{{p0}} 的内容', { p0: path })}
        onScroll={(event) => {
          const node = event.currentTarget;
          setTop(node.scrollTop);
          onScroll({ top: node.scrollTop, left: node.scrollLeft });
        }}
      >
        <div
          className="file-code-lines"
          style={{
            height: count * rowHeight,
            minWidth: `max(100%, calc(${columns + 2}ch + ${diff ? 100 : 62}px))`,
          }}
        >
          {Array.from({ length: end - start }, (_, offset) => {
            const index = start + offset,
              change = changes[index];
            const canComment = review && (change?.kind === 'add' || change?.kind === 'remove');
            const location = canComment
              ? change.kind === 'add'
                ? t('新侧第 {{line}} 行', { line: change.next })
                : t('旧侧第 {{line}} 行', { line: change.old })
              : '';
            return (
              <div
                key={index}
                className={`file-code-line ${change ? `file-diff-${change.kind}` : ''} ${find && query && matchingLines.has(index) ? 'is-match' : ''} ${find && query && selected === index ? 'is-current-match' : ''}`}
                style={{ top: index * rowHeight, height: rowHeight, lineHeight: rowHeight + 'px' }}
              >
                <span className="file-line-number" aria-hidden="true">
                  {diff ? `${change?.old ?? ''}` : index + 1}
                </span>
                {diff && (
                  <span className="file-line-number file-new-line" aria-hidden="true">
                    {change?.next ?? ''}
                  </span>
                )}
                {canComment && (
                  <button
                    type="button"
                    className="diff-line-comment"
                    aria-label={t('评论{{location}}', { location })}
                    onClick={() => {
                      setAnchor({
                        target: review.target,
                        path,
                        location,
                        original: change.text,
                        base: review.base,
                        head: review.head,
                      });
                      setOpinion('');
                    }}
                  >
                    +
                  </button>
                )}
                {diff ? (
                  <code>{change?.text || ' '}</code>
                ) : (
                  <code dangerouslySetInnerHTML={{ __html: html[index] || ' ' }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
