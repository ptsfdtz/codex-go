import { useEffect, useRef, type ReactNode } from 'react';
import { X, type LucideIcon } from 'lucide-react';
import { useMotionPresence } from './motion';
export function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  className = '',
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={19} strokeWidth={1.6} />
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  header,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  header?: ReactNode;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const present = useMotionPresence();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  useEffect(() => {
    // A native modal escapes an ancestor's inert state in the top layer.
    if (dialog.current) dialog.current.inert = !present;
  }, [present]);
  return (
    <dialog
      ref={dialog}
      className={`modal ${wide ? 'modal-wide' : ''} ${className}`}
      aria-label={title}
      data-motion={present ? 'open' : 'closed'}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
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
