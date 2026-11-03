import { useLayoutEffect, useRef, useState } from 'react';
import { t, useLocale } from '../i18n';
import { usePreference } from './preferences';
import './sidebar-resizer.css';

const minimum = 220;
const collapseAt = 180;

export function SidebarResizer({ open, onClose }: { open: boolean; onClose: () => void }) {
  useLocale();
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | undefined>(
    undefined,
  );
  const [preferred, savePreferred] = usePreference(
    'agentdeck.web.sidebar-width',
    '',
    (value): value is string =>
      typeof value === 'string' &&
      (value === '' ||
        (Number.isFinite(Number(value)) && Number(value) >= minimum && Number(value) <= 480)),
  );
  const [width, setWidth] = useState(280);
  const [maximum, setMaximum] = useState(480);
  const currentWidth = useRef(width);
  const shell = () => handle.current?.closest<HTMLElement>('.shell');
  function limit() {
    const root = shell();
    const available = root?.clientWidth || window.innerWidth;
    return Math.floor(
      matchMedia('(max-width: 760px)').matches ? available * 0.85 : Math.min(480, available * 0.45),
    );
  }
  function apply(value: number) {
    const max = limit();
    const next = Math.round(Math.min(max, Math.max(Math.min(minimum, max), value)));
    shell()?.style.setProperty('--sidebar-width', `${next}px`);
    currentWidth.current = next;
    setWidth(next);
    setMaximum(max);
  }
  function restore() {
    const root = shell();
    if (!root) return;
    root.style.removeProperty('--sidebar-width');
    apply(
      preferred
        ? Number(preferred)
        : parseFloat(getComputedStyle(root).getPropertyValue('--sidebar-width')),
    );
  }
  function finish(cancelled: boolean) {
    const active = drag.current;
    if (!active) return;
    drag.current = undefined;
    shell()?.removeAttribute('data-sidebar-resizing');
    if (cancelled) apply(active.startWidth);
    else savePreferred(String(currentWidth.current));
    if (handle.current?.hasPointerCapture(active.pointerId))
      handle.current.releasePointerCapture(active.pointerId);
  }
  function collapse() {
    const root = shell();
    finish(true);
    // The motion hook consumes this flag so a drag collapse hides immediately.
    root?.setAttribute('data-sidebar-collapse', 'true');
    onClose();
    requestAnimationFrame(() =>
      root
        ?.querySelector<HTMLButtonElement>('.conversation-layout .topbar button')
        ?.focus({ preventScroll: true }),
    );
  }
  useLayoutEffect(() => {
    if (!drag.current) restore();
  }, [preferred]);
  useLayoutEffect(() => {
    if (!open) finish(true);
  }, [open]);
  // Capture loss, focus loss, viewport changes and unmount must never leave a
  // pointer gesture or selection suppression attached to the shared shell.
  const lifecycle = useRef({ finish, restore });
  lifecycle.current = { finish, restore };
  useLayoutEffect(() => {
    const root = shell();
    const resize = () => {
      lifecycle.current.finish(true);
      lifecycle.current.restore();
    };
    const blur = () => lifecycle.current.finish(true);
    window.addEventListener('resize', resize);
    window.addEventListener('blur', blur);
    return () => {
      lifecycle.current.finish(true);
      root?.removeAttribute('data-sidebar-resizing');
      root?.removeAttribute('data-sidebar-collapse');
      root?.style.removeProperty('--sidebar-width');
      window.removeEventListener('resize', resize);
      window.removeEventListener('blur', blur);
    };
  }, []);
  return (
    <div
      ref={handle}
      className="sidebar-resizer"
      role="separator"
      aria-label={t('调整侧边栏宽度')}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={maximum}
      aria-valuenow={width}
      tabIndex={open ? 0 : -1}
      onDoubleClick={() => {
        finish(true);
        savePreferred('');
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          if (drag.current) {
            event.preventDefault();
            finish(true);
          }
          return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = currentWidth.current + (event.key === 'ArrowLeft' ? -20 : 20);
        if (event.key === 'Home' || (event.key === 'ArrowLeft' && next < minimum)) collapse();
        else {
          apply(event.key === 'End' ? limit() : next);
          savePreferred(String(currentWidth.current));
        }
      }}
      onPointerDown={(event) => {
        if (!open || event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        const root = shell();
        if (!root) return;
        for (const node of root.querySelectorAll<HTMLElement>(
          ':scope > .sidebar, :scope > .sidebar-scrim, :scope > .conversation-layout',
        ))
          for (const animation of node.getAnimations()) animation.finish();
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: currentWidth.current,
        };
        event.currentTarget.focus({ preventScroll: true });
        root.setAttribute('data-sidebar-resizing', 'true');
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        const next = active.startWidth + event.clientX - active.startX;
        if (next < collapseAt) collapse();
        else apply(next);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId === event.pointerId) finish(false);
      }}
      onPointerCancel={() => finish(true)}
      onLostPointerCapture={() => finish(true)}
    />
  );
}
