import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { Draft } from '../workspace';

// Presentation only: draft consumption remains owned by the sending caller.
export function useSendMotion(
  input: RefObject<HTMLTextAreaElement | null>,
  draft: Draft,
  busy: boolean,
  blocked: boolean,
) {
  const attempt = useRef<{ text: string; busy: boolean } | undefined>(undefined);
  const flights = useRef(new Set<HTMLElement>());
  const animations = useRef(new Set<Animation>());
  function animate(node: HTMLElement, frames: Keyframe[], duration: number) {
    const animation = node.animate(frames, { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    animations.current.add(animation);
    animation.finished.then(
      () => animations.current.delete(animation),
      () => animations.current.delete(animation),
    );
    return animation;
  }
  function begin() {
    attempt.current = { text: draft.text, busy: false };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const arrow = input.current
      ?.closest('.composer')
      ?.querySelector<HTMLElement>('.send-button svg');
    if (arrow)
      animate(
        arrow,
        [
          { transform: 'translateY(0)', opacity: 1 },
          { transform: 'translateY(-7px)', opacity: 0, offset: 0.45 },
          { transform: 'translateY(4px)', opacity: 0, offset: 0.46 },
          { transform: 'translateY(0)', opacity: 1 },
        ],
        260,
      );
  }
  useLayoutEffect(() => {
    const source = attempt.current;
    if (!source) return;
    source.busy ||= busy;
    if (blocked || (draft.text && draft.text !== source.text)) {
      attempt.current = undefined;
      return;
    }
    const node = input.current;
    if (
      !draft.text &&
      source.text &&
      node &&
      !draft.attachments.length &&
      !draft.references?.length &&
      !draft.skills.length
    ) {
      attempt.current = undefined;
      if (
        matchMedia('(prefers-reduced-motion: reduce)').matches ||
        document.visibilityState !== 'visible'
      )
        return;
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const style = getComputedStyle(node);
      const ghost = document.createElement('div');
      ghost.className = 'composer-send-flight';
      ghost.setAttribute('aria-hidden', 'true');
      ghost.textContent = source.text;
      Object.assign(ghost.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        font: style.font,
        lineHeight: style.lineHeight,
        color: style.color,
        padding: style.padding,
      });
      node.closest('.composer-wrap')?.append(ghost);
      ghost.scrollTop = node.scrollTop;
      flights.current.add(ghost);
      const flight = animate(
        ghost,
        [
          { transform: 'translateY(0)', opacity: 0.9 },
          { transform: 'translateY(-28px)', opacity: 0.65, offset: 0.55 },
          { transform: 'translateY(-56px)', opacity: 0 },
        ],
        340,
      );
      const remove = () => {
        ghost.remove();
        flights.current.delete(ghost);
      };
      flight.finished.then(remove, remove);
      // The Composer measures its empty textarea in the next layout effect.
      const frame = requestAnimationFrame(() => {
        const height = node.getBoundingClientRect().height;
        if (height < rect.height)
          animate(node, [{ height: `${rect.height}px` }, { height: `${height}px` }], 240);
      });
      return () => cancelAnimationFrame(frame);
    }
    if (source.busy && !busy) attempt.current = undefined;
  }, [draft, busy, blocked, input]);
  useEffect(() => {
    const active = animations.current,
      elements = flights.current;
    return () => {
      for (const animation of active) animation.cancel();
      for (const element of elements) element.remove();
      active.clear();
      elements.clear();
    };
  }, []);
  return begin;
}
