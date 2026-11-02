import { t, useLocale } from './i18n';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { LoaderCircle, X, type LucideIcon } from 'lucide-react';
import { useMotionPresence } from './motion';
export function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  className = '',
  pressed,
  pending = false,
  badge,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  pressed?: boolean;
  pending?: boolean;
  badge?: string;
}) {
  useLocale();
  return (
    <button
      type="button"
      className={`icon-button ${className} ${badge ? 'notification-badge-button' : ''}`}
      title={label}
      aria-label={label}
      disabled={disabled || pending}
      aria-pressed={pressed}
      aria-busy={pending || undefined}
      aria-description={badge}
      onClick={onClick}
    >
      {pending ? (
        <LoaderCircle className="pending-icon" size={19} aria-hidden="true" />
      ) : (
        <Icon size={19} strokeWidth={1.6} aria-hidden="true" />
      )}
      {badge && <span className="notification-dot" aria-hidden="true" />}
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  compact = false,
  header,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  compact?: boolean;
  header?: ReactNode;
  className?: string;
}) {
  useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const present = useMotionPresence();
  const backdropPress = useRef(false);
  const outside = (event: { clientX: number; clientY: number }) => {
    const box = dialog.current?.getBoundingClientRect();
    return (
      !!box &&
      (event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom)
    );
  };
  const [entered, setEntered] = useState(false);
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    node.showModal();
    // Commit the hidden state in the top layer before transitioning. Safari
    // can skip @starting-style when showModal runs after the first render.
    getComputedStyle(node).getPropertyValue('opacity');
    getComputedStyle(node, '::backdrop').getPropertyValue('background-color');
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => {
      cancelAnimationFrame(frame);
      node.close();
    };
  }, []);
  useLayoutEffect(() => {
    // A native modal escapes an ancestor's inert state in the top layer.
    if (dialog.current) dialog.current.inert = !present;
  }, [present]);
  return (
    <dialog
      ref={dialog}
      className={`modal ${wide ? 'modal-wide' : ''} ${compact ? 'modal-compact' : ''} ${className}`}
      aria-label={title}
      data-motion={present && entered ? 'open' : 'closed'}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        backdropPress.current = event.target === dialog.current && outside(event);
      }}
      onClick={(event) => {
        if (event.target === dialog.current && backdropPress.current && outside(event)) onClose();
        backdropPress.current = false;
      }}
    >
      <div className="modal-title">
        {header || <h2>{title}</h2>}
        <IconButton icon={X} label={t('关闭')} onClick={onClose} />
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function DataFields({ value }: { value: unknown }) {
  useLocale();
  if (!value || typeof value !== 'object') return <p>{String(value ?? '—')}</p>;
  return (
    <dl className="data-fields">
      {Object.entries(value)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([key, v]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{typeof v === 'object' ? <pre>{JSON.stringify(v, null, 2)}</pre> : String(v)}</dd>
          </div>
        ))}
    </dl>
  );
}
