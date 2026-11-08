import { useLayoutEffect } from 'react';
import { usePopoverMotion } from '../motion';

/** Keep anchored menus within the visible viewport, including the soft keyboard. */
export function positionPopover(
  trigger: HTMLElement,
  popup: HTMLElement,
  {
    width,
    preferAbove = false,
    align = 'start',
  }: { width: number; preferAbove?: boolean; align?: 'start' | 'center' | 'end' },
) {
  const box = trigger.getBoundingClientRect();
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft || 0;
  const top = viewport?.offsetTop || 0;
  const viewWidth = viewport?.width || window.innerWidth;
  const viewHeight = viewport?.height || window.innerHeight;
  const panelWidth = Math.min(width, viewWidth - 24);
  const below = Math.max(0, top + viewHeight - box.bottom - 18);
  const above = Math.max(0, box.top - top - 18);
  const up = preferAbove ? above >= 240 || above > below : below < 240 && above > below;
  const panelLeft =
    align === 'center'
      ? left + (viewWidth - panelWidth) / 2
      : align === 'end'
        ? box.right - panelWidth
        : box.left;
  const clampedLeft = Math.max(left + 12, Math.min(panelLeft, left + viewWidth - panelWidth - 12));
  const origin = Math.max(0, Math.min(panelWidth, box.left + box.width / 2 - clampedLeft));
  popup.style.width = `${panelWidth}px`;
  popup.style.left = `${clampedLeft}px`;
  popup.style.top = up ? 'auto' : `${box.bottom + 6}px`;
  popup.style.bottom = up ? `${window.innerHeight - box.top + 6}px` : 'auto';
  popup.style.maxHeight = `${up ? above : below}px`;
  popup.style.transformOrigin = `${origin}px ${up ? 'bottom' : 'top'}`;
  popup.style.setProperty('--popover-offset', up ? '6px' : '-6px');
}

/** Shared dismissal, trigger state and keyboard behavior for button menus. */
export function useMenuPopover(
  reposition?: (trigger: HTMLButtonElement, popup: HTMLElement) => void,
) {
  const ref = usePopoverMotion();
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const trigger = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[popovertarget]'),
    ).find((button) => button.getAttribute('popovertarget') === node.id);
    if (!trigger) return;
    trigger.setAttribute('aria-controls', node.id);
    trigger.setAttribute('aria-expanded', 'false');
    const buttons = () =>
      Array.from(node.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')).filter(
        (button) => !button.closest('[inert]') && button.getClientRects().length > 0,
      );
    const toggle = () =>
      trigger.setAttribute('aria-expanded', String(node.matches(':popover-open')));
    const openWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      if (!node.matches(':popover-open')) trigger.click();
      requestAnimationFrame(() => {
        if (node.matches(':popover-open'))
          (event.key === 'ArrowUp' ? buttons().at(-1) : buttons()[0])?.focus({
            preventScroll: true,
          });
      });
    };
    const navigate = (event: KeyboardEvent) => {
      // Sliders, search fields and other compound controls keep their own keys.
      if (!(event.target instanceof HTMLButtonElement)) return;
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const options = buttons();
      if (!options.length) return;
      event.preventDefault();
      const index = options.indexOf(event.target);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? options.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[next]?.focus({ preventScroll: true });
      options[next]?.scrollIntoView({ block: 'nearest' });
    };
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && node.contains(event.target)) return;
      if (node.matches(':popover-open')) node.hidePopover();
    };
    const blur = (event: FocusEvent) => {
      if (event.target !== trigger) dismiss(event);
    };
    const scroll = (event: Event) => {
      // Unrelated timeline updates can scroll while a composer/menu is opening.
      // Only a scroller that moves this trigger invalidates its anchor.
      if (
        event.target === document ||
        (event.target instanceof Element && event.target.contains(trigger))
      )
        dismiss(event);
    };
    const viewportChanged = (event: Event) => {
      if (!node.matches(':popover-open')) return;
      if (reposition) reposition(trigger, node);
      else dismiss(event);
    };
    node.addEventListener('toggle', toggle);
    node.addEventListener('keydown', navigate);
    trigger.addEventListener('keydown', openWithKeyboard);
    document.addEventListener('focusin', blur);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', viewportChanged);
    window.visualViewport?.addEventListener('resize', viewportChanged);
    if (reposition) window.visualViewport?.addEventListener('scroll', viewportChanged);
    return () => {
      node.removeEventListener('toggle', toggle);
      node.removeEventListener('keydown', navigate);
      trigger.removeEventListener('keydown', openWithKeyboard);
      document.removeEventListener('focusin', blur);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', viewportChanged);
      window.visualViewport?.removeEventListener('resize', viewportChanged);
      window.visualViewport?.removeEventListener('scroll', viewportChanged);
    };
  }, [ref, reposition]);
  return ref;
}
