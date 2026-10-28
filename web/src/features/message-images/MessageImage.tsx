import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { Request } from '../../workspace';
import { Modal } from '../../ui';
import { MotionPresence } from '../../motion';
import { readProjectImage } from '../project-image';
import { projectRelativePath } from '../turn-changes';

export type MessageImageSource = { request: Request; projectId: string; root: string };

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
    [error, setError] = useState(''),
    [expanded, setExpanded] = useState(false);
  const path = src && source ? projectRelativePath(src, source.root) : undefined;
  const remote = !!src && /^https?:\/\//i.test(src);
  const request = source?.request,
    projectId = source?.projectId;
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
    setExpanded(false);
    if (!visible || !request || !projectId || !path || remote) return;
    let current = true,
      objectUrl = '';
    void readProjectImage(request, projectId, path, () => current)
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
  }, [visible, request, projectId, path, remote, attempt]);
  const label = alt || '回复图片';
  return (
    <span ref={element} className="message-image">
      {url ? (
        <button
          className="message-image-open"
          aria-label={`放大图片 ${label}`}
          onClick={() => setExpanded(true)}
        >
          <img
            src={url}
            alt={label}
            onError={() => {
              setError('图片解码失败');
              setUrl('');
            }}
          />
        </button>
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
                ? '连接支持图片预览的项目电脑后查看'
                : !path
                  ? '图片路径不在当前授权项目内'
                  : '读取图片中…'}
            </span>
          )}
        </span>
      )}
      {createPortal(
        <MotionPresence>
          {expanded && url && (
            <Modal title={label} wide onClose={() => setExpanded(false)}>
              <img className="message-image-expanded" src={url} alt={label} />
            </Modal>
          )}
        </MotionPresence>,
        document.body,
      )}
    </span>
  );
}
