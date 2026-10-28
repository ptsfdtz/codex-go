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
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  pressed?: boolean;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      title={label}
      aria-label={label}
      disabled={disabled || pending}
      aria-pressed={pressed}
      aria-busy={pending || undefined}
      onClick={onClick}
    >
      {pending ? (
        <LoaderCircle className="pending-icon" size={19} aria-hidden="true" />
      ) : (
        <Icon size={19} strokeWidth={1.6} aria-hidden="true" />
      )}
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
  const dialog = useRef<HTMLDialogElement>(null);
  const present = useMotionPresence();
  const backdropPress = useRef(false);
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
        backdropPress.current = event.target === dialog.current;
      }}
      onClick={(event) => {
        if (event.target === dialog.current && backdropPress.current) onClose();
        backdropPress.current = false;
      }}
    >
      <div className="modal-title">
        {header || <h2>{title}</h2>}
        <IconButton icon={X} label="关闭" onClick={onClose} />
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function DataFields({ value }: { value: unknown }) {
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
