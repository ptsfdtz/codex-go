import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const PresenceContext = createContext(true);
export const useMotionPresence = () => useContext(PresenceContext);

export function motionDuration(milliseconds: number) {
  if (document.documentElement.dataset.motionInput === 'keyboard') return 0;
  return matchMedia('(prefers-reduced-motion: reduce)').matches ? 100 : milliseconds;
}

// Retain exiting content long enough for CSS transitions. Reopening cancels the
// exit, so rapid toggles reverse the current transition instead of restarting.
export function MotionPresence({ children }: { children: ReactNode }) {
  const active = !!children;
  const last = useRef(children);
  const [retained, setRetained] = useState(active);
  useLayoutEffect(() => {
    if (active) {
      last.current = children;
      setRetained(true);
    }
  }, [active, children]);
  useLayoutEffect(() => {
    if (active) return;
    const timer = setTimeout(() => setRetained(false), motionDuration(200));
    return () => clearTimeout(timer);
  }, [active]);
  if (!active && !retained) return null;
  return (
    <PresenceContext.Provider value={active}>
      <div className="motion-presence" data-motion={active ? 'open' : 'closed'} inert={!active}>
        {active ? children : last.current}
      </div>
    </PresenceContext.Provider>
  );
}

// Only accordions animate height; the inner observer also handles async content.
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const node = content.current;
    if (!node) return;
    const measure = () => setHeight(node.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className="motion-collapse"
      data-open={open}
      style={{ height: open ? height : 0 }}
      inert={!open}
      aria-hidden={!open}
    >
      <div ref={content}>{children}</div>
    </div>
  );
}

export function initializeMotion() {
  const root = document.documentElement;
  const keyboard = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
      return;
    root.dataset.motionInput = 'keyboard';
  };
  window.addEventListener('keydown', keyboard, true);
  window.addEventListener(
    'pointerdown',
    () => {
      root.dataset.motionInput = 'pointer';
    },
    true,
  );
}

// FLIP the conversation when a desktop rail changes its layout. Its text is
// never scaled, and rapid toggles start from the current visual position.
export function useSidebarMotion(open: boolean) {
  const ref = useRef<HTMLElement>(null);
  const previousLeft = useRef<number | undefined>(undefined);
  const previousOpen = useRef(open);
  const animation = useRef<Animation | undefined>(undefined);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const transform = getComputedStyle(node).transform;
    const offset = transform === 'none' ? 0 : new DOMMatrix(transform).m41;
    const left = node.getBoundingClientRect().left - offset;
    if (
      previousLeft.current !== undefined &&
      Math.abs(previousLeft.current - left) < 0.5 &&
      previousOpen.current === open
    )
      return;
    previousOpen.current = open;
    const delta = previousLeft.current === undefined ? 0 : previousLeft.current + offset - left;
    previousLeft.current = left;
    animation.current?.cancel();
    if (delta && matchMedia('(min-width: 761px)').matches && motionDuration(280) > 100) {
      animation.current = node.animate(
        [{ transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' }],
        { duration: 280, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
      );
    }
  });
  return ref;
}
