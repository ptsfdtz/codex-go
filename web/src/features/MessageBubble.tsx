import { useEffect, useRef, type ReactNode } from 'react';

export function MessageBubble({
  className,
  onEdit,
  children,
}: {
  className: string;
  onEdit?: () => void;
  children: ReactNode;
}) {
  const press = useRef<{ pointer: number; x: number; y: number; timer: number } | undefined>(
    undefined,
  );
  const edit = useRef(onEdit);
  edit.current = onEdit;

  function cancelPress() {
    window.clearTimeout(press.current?.timer);
    press.current = undefined;
  }

  useEffect(() => cancelPress, []);

  if (!onEdit) return <div className={className}>{children}</div>;

  return (
    <div
      className={className}
      tabIndex={0}
      aria-keyshortcuts="F2"
      onPointerDown={(event) => {
        if (
          event.pointerType === 'mouse' ||
          !event.isPrimary ||
          (event.target as Element).closest('a, button, input, textarea, select')
        )
          return;
        cancelPress();
        press.current = {
          pointer: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          timer: window.setTimeout(() => {
            cancelPress();
            if (!window.getSelection()?.toString()) edit.current?.();
          }, 500),
        };
      }}
      onPointerMove={(event) => {
        const start = press.current;
        if (
          start?.pointer === event.pointerId &&
          Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8
        )
          cancelPress();
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onPointerLeave={cancelPress}
      onContextMenu={(event) => {
        if (press.current) event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === 'F2') {
          event.preventDefault();
          onEdit();
        }
      }}
    >
      {children}
    </div>
  );
}
