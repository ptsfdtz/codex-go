import { useEffect, useRef, useState } from 'react';
import type { Request } from '../../workspace';
import type { Bridge } from '../../transport/bridge';
import { readHistoryImage } from '../../media';
import { ImagePreview } from './ImagePreview';
import { readProjectImage } from '../project-image';
import { projectRelativePath } from '../turn-changes';

export type MessageImageSource = {
  request: Request;
  projectId: string;
  root: string;
  session?: { connection: Bridge; sessionId: string; turnId: string; itemId: string };
};

export function MessageImage({
  src,
  alt,
  source,
}: {
  src?: string;
  alt?: string;
  source?: MessageImageSource;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [url, setUrl] = useState(''),
    [error, setError] = useState('');
  const path = src && source ? projectRelativePath(src, source.root) : undefined;
  const remote = !!src && /^https?:\/\//i.test(src);
  const request = source?.session ? undefined : source?.request,
    projectId = source?.projectId;
  const sessionConnection = source?.session?.connection;
  const sessionId = source?.session?.sessionId;
  const turnId = source?.session?.turnId;
  const itemId = source?.session?.itemId;
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setUrl('');
    setError('');
    if (!visible || !src || remote) return;
    const sessionImage = sessionConnection && sessionId && turnId && itemId;
    if (!sessionImage && (!request || !projectId || !path)) return;
    let current = true,
      objectUrl = '';
    const read = sessionImage
      ? readHistoryImage(sessionConnection, sessionId, turnId, itemId, 0, () => current, src)
      : readProjectImage(request!, projectId!, path!, () => current);
    void read
      .then((blob) => {
        if (!current) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((error) => {
        if (current) setError(String(error));
      });
    return () => {
      current = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    visible,
    request,
    projectId,
    path,
    remote,
    attempt,
    src,
    sessionConnection,
    sessionId,
    turnId,
    itemId,
  ]);
  const label = alt || '回复图片';
  return (
    <span ref={element} className="message-image">
      {url ? (
        <ImagePreview
          key={url}
          src={url}
          alt={label}
          onError={() => {
            setError('图片解码失败');
            setUrl('');
          }}
        />
      ) : remote ? (
        <a href={src} target="_blank" rel="noreferrer noopener">
          打开图片：{label}
        </a>
      ) : (
        <span className="message-image-placeholder" role="status">
          <span>{label}</span>
          {error ? (
            <>
              <span className="muted">图片读取失败：{error}</span>
              <button className="text-button" onClick={() => setAttempt((value) => value + 1)}>
                重试读取图片
              </button>
            </>
          ) : (
            <span className="muted">
              {!source
                ? '连接电脑后查看图片'
                : !path && !source.session
                  ? '升级 Host 后可查看此会话图片'
                  : '读取图片中…'}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
