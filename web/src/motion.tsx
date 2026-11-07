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
  return matchMedia('(prefers-reduced-motion: reduce)').matches ? 100 : milliseconds;
}

export function useMotionRetention(active: boolean, duration: number) {
  const [retained, setRetained] = useState(active);
  useLayoutEffect(() => {
    if (active) {
      setRetained(true);
      return;
    }
    const timer = setTimeout(() => setRetained(false), motionDuration(duration));
    return () => clearTimeout(timer);
  }, [active, duration]);
  return active || retained;
}

// Retain exiting content long enough for CSS transitions. Reopening cancels the
// exit, so rapid toggles reverse the current transition instead of restarting.
export function MotionPresence({
  children,
  duration = 280,
}: {
  children: ReactNode;
  duration?: number;
}) {
  const active = !!children;
  const last = useRef(children);
  const retained = useMotionRetention(active, duration);
  const [entered, setEntered] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!active) {
      setEntered(false);
      return;
    }
    // Explicit initial styles also work when @starting-style is unsupported
    // or the browser has already styled the newly inserted surface.
    for (const child of container.current?.children || [])
      getComputedStyle(child).getPropertyValue('opacity');
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [active]);
  useLayoutEffect(() => {
    if (active) last.current = children;
  }, [active, children]);
  if (!retained) return null;
  return (
    <PresenceContext.Provider value={active}>
      <div
        ref={container}
        className="motion-presence"
        data-motion={active && entered ? 'open' : 'closed'}
        inert={!active}
      >
        {active ? children : last.current}
      </div>
    </PresenceContext.Provider>
  );
}

// Native popovers keep their light-dismiss and focus behavior; opening has an
// explicit animation instead of depending on display-transition support.
export function usePopoverMotion() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Modern browsers use one CSS timeline for both open and close. WAAPI is
    // only a fallback, never a second owner of the same transform.
    if (CSS.supports('transition-behavior', 'allow-discrete')) return;
    let animation: Animation | undefined;
    const toggle = (event: Event) => {
      animation?.cancel();
      if ((event as ToggleEvent).newState !== 'open') return;
      const duration = motionDuration(200);
      const offset = node.style.getPropertyValue('--popover-offset') || '6px';
      const transform = duration <= 100 ? 'none' : `translateY(${offset}) scale(0.97)`;
      animation = node.animate(
        [
          { opacity: 0, transform },
          { opacity: 1, transform: 'translateY(0) scale(1)' },
        ],
        {
          duration,
          easing: getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim(),
        },
      );
    };
    node.addEventListener('beforetoggle', toggle);
    return () => {
      node.removeEventListener('beforetoggle', toggle);
      animation?.cancel();
    };
  }, []);
  return ref;
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

// Keyed lists animate their items in container coordinates, so scrolling or
// moving the entire panel never becomes an unwanted list animation.
export function MotionList({
  children,
  className,
  label,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  label?: string;
  as?: 'div' | 'nav';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<Element, { left: number; top: number }>());
  const running = useRef(new Map<Element, Animation>());
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const root = node.getBoundingClientRect();
    const positions = new Map<Element, { left: number; top: number }>();
    const duration = motionDuration(200);
    if (duration <= 100) {
      for (const animation of running.current.values()) animation.cancel();
      running.current.clear();
    }
    const easing = getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim();
    const moves: { child: HTMLElement; dx: number; dy: number }[] = [];
    // Bound measurement cost on large directories; their controls still have
    // state feedback without animating hundreds of offscreen rows.
    if (node.children.length > 120) {
      for (const animation of running.current.values()) animation.cancel();
      running.current.clear();
      previous.current.clear();
      return;
    }
    for (const child of node.children) {
      if (!(child instanceof HTMLElement) || !child.hasAttribute('data-motion-item')) continue;
      const rect = child.getBoundingClientRect();
      const transform = getComputedStyle(child).transform;
      const matrix = transform === 'none' ? undefined : new DOMMatrix(transform);
      const position = {
        left: rect.left - root.left - (matrix?.m41 || 0),
        top: rect.top - root.top - (matrix?.m42 || 0),
      };
      positions.set(child, position);
      const before = previous.current.get(child);
      if (!before || duration <= 100) continue;
      if (Math.abs(before.left - position.left) < 0.5 && Math.abs(before.top - position.top) < 0.5)
        continue;
      const dx = before.left - position.left + (matrix?.m41 || 0);
      const dy = before.top - position.top + (matrix?.m42 || 0);
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      moves.push({ child, dx, dy });
    }
    // Complete every layout read before writing animation state.
    for (const { child, dx, dy } of moves) {
      running.current.get(child)?.cancel();
      const animation = child.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration, easing },
      );
      running.current.set(child, animation);
      animation.onfinish = () => {
        if (running.current.get(child) === animation) running.current.delete(child);
      };
    }
    for (const [child, animation] of running.current) {
      if (!positions.has(child)) {
        animation.cancel();
        running.current.delete(child);
      }
    }
    previous.current = positions;
  });
  useLayoutEffect(() => {
    const animations = running.current;
    return () => {
      for (const animation of animations.values()) animation.cancel();
    };
  }, []);
  return (
    <Tag ref={ref} className={className} aria-label={label}>
      {children}
    </Tag>
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
  // Safari versions without intrinsic-size transitions still get reversible
  // details motion. Keep native summary semantics and React's toggle events.
  if (!CSS.supports('interpolate-size', 'allow-keywords')) {
    const states = new WeakMap<
      HTMLDetailsElement,
      {
        open: boolean;
        animation?: Animation;
        overflow: string;
      }
    >();
    document.addEventListener('click', (event) => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      const summary = event.target.closest('summary');
      const node = summary?.parentElement;
      if (
        !(node instanceof HTMLDetailsElement) ||
        !summary ||
        event.target.closest('button, a, input, select, textarea')
      )
        return;
      const old = states.get(node);
      const duration = motionDuration(200);
      if (duration <= 100) {
        if (old) {
          event.preventDefault();
          old.animation?.cancel();
          node.open = !old.open;
          node.style.overflow = old.overflow;
          states.delete(node);
        }
        return;
      }
      event.preventDefault();
      const from = node.getBoundingClientRect().height;
      const state = {
        open: !(old?.open ?? node.open),
        overflow: old?.overflow ?? node.style.overflow,
        animation: undefined as Animation | undefined,
      };
      old?.animation?.cancel();
      states.set(node, state);
      node.open = true;
      requestAnimationFrame(() => {
        if (!node.isConnected || states.get(node) !== state) return;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const closed =
          summary.getBoundingClientRect().bottom -
          rect.top +
          parseFloat(style.paddingBottom || '0') +
          parseFloat(style.borderBottomWidth || '0');
        const to = state.open ? rect.height : closed;
        node.style.overflow = 'clip';
        const animation = node.animate([{ height: `${from}px` }, { height: `${to}px` }], {
          duration,
          easing: getComputedStyle(root).getPropertyValue('--ease-out').trim(),
        });
        state.animation = animation;
        animation.onfinish = () => {
          if (states.get(node) !== state) return;
          node.open = state.open;
          node.style.overflow = state.overflow;
          states.delete(node);
        };
      });
    });
  }
}

// Keep the drawer visible until its exit finishes. Animate the desktop gutter
// with it, so content reflows continuously instead of jumping to its final width.
export function useSidebarMotion(open: boolean) {
  const ref = useRef<HTMLElement>(null);
  const previous = useRef<{ node: HTMLElement; open: boolean; desktop: boolean } | undefined>(
    undefined,
  );
  const running = useRef(new Map<HTMLElement, Animation>());
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const sidebar = node.parentElement?.querySelector<HTMLElement>(':scope > .sidebar');
    const scrim = node.parentElement?.querySelector<HTMLElement>(':scope > .sidebar-scrim');
    if (!sidebar || !scrim) return;
    const desktop = matchMedia('(min-width: 761px)').matches;
    const before = previous.current;
    if (before?.node === node && before.open === open && before.desktop === desktop) return;
    const width = sidebar.getBoundingClientRect().width;
    const fullPage = !desktop && getComputedStyle(scrim).display === 'none';
    // iOS navigation keeps the previous page behind the incoming page, with
    // one-third travel rather than moving both pages like a carousel.
    const sidebarTravel = fullPage ? width / 3 : width;
    // Read interrupted positions before cancelling any timeline.
    const sidebarStyle = getComputedStyle(sidebar);
    const sidebarOffset = running.current.has(sidebar)
      ? sidebarStyle.transform === 'none'
        ? 0
        : new DOMMatrix(sidebarStyle.transform).m41
      : before?.open
        ? 0
        : -sidebarTravel;
    const pageTransform = running.current.has(node) ? getComputedStyle(node).transform : 'none';
    const pageOffset =
      pageTransform !== 'none'
        ? new DOMMatrix(pageTransform).m41
        : before?.open && fullPage
          ? width
          : 0;
    const sidebarOpacity = running.current.has(sidebar)
      ? sidebarStyle.opacity
      : before?.open
        ? '1'
        : '0';
    const parallaxOpacity = running.current.has(sidebar)
      ? sidebarStyle.opacity
      : before?.open
        ? '1'
        : '0.8';
    const margin = running.current.has(node)
      ? parseFloat(getComputedStyle(node).marginLeft)
      : before?.open && desktop
        ? width
        : 0;
    const pageOpacity = running.current.has(node)
      ? getComputedStyle(node).opacity
      : before?.open
        ? '0'
        : '1';
    const scrimOpacity = running.current.has(scrim)
      ? getComputedStyle(scrim).opacity
      : before?.open
        ? '1'
        : '0';
    for (const [element, animation] of running.current) {
      animation.cancel();
      element.style.visibility = '';
      element.removeAttribute('data-page-motion');
    }
    running.current.clear();
    previous.current = { node, open, desktop };
    if (node.parentElement?.hasAttribute('data-sidebar-collapse')) {
      node.parentElement.removeAttribute('data-sidebar-collapse');
      return;
    }
    if (!before || before.node !== node || before.desktop !== desktop || before.open === open)
      return;
    const style = getComputedStyle(document.documentElement);
    // Production CSS minifiers may rewrite 320ms as .32s.
    const cssDuration = style.getPropertyValue('--motion-drawer').trim();
    const milliseconds = parseFloat(cssDuration) * (cssDuration.endsWith('ms') ? 1 : 1000);
    const duration = motionDuration(Number.isFinite(milliseconds) ? milliseconds : 0);
    if (!duration) return;
    const easing = style.getPropertyValue('--ease-drawer').trim();
    const startTime = document.timeline.currentTime;
    const animate = (element: HTMLElement, frames: Keyframe[]) => {
      element.style.visibility = 'visible';
      const animation = element.animate(frames, { duration, easing });
      if (startTime !== null) animation.startTime = startTime;
      running.current.set(element, animation);
      animation.onfinish = () => {
        if (running.current.get(element) !== animation) return;
        element.style.visibility = '';
        element.removeAttribute('data-page-motion');
        running.current.delete(element);
      };
    };
    if (duration > 100) {
      animate(sidebar, [
        {
          transform: `translateX(${sidebarOffset}px)`,
          ...(fullPage ? { opacity: parallaxOpacity } : {}),
        },
        {
          transform: `translateX(${open ? 0 : -sidebarTravel}px)`,
          ...(fullPage ? { opacity: open ? 1 : 0.8 } : {}),
        },
      ]);
      if (desktop)
        animate(node, [{ marginLeft: `${margin}px` }, { marginLeft: `${open ? width : 0}px` }]);
      else if (fullPage) {
        node.setAttribute('data-page-motion', '');
        animate(node, [
          { transform: `translateX(${pageOffset}px)` },
          { transform: `translateX(${open ? width : 0}px)` },
        ]);
      }
    } else {
      animate(sidebar, [{ opacity: sidebarOpacity }, { opacity: open ? 1 : 0 }]);
      if (fullPage) {
        node.setAttribute('data-page-motion', '');
        animate(node, [{ opacity: pageOpacity }, { opacity: open ? 0 : 1 }]);
      }
    }
    if (!desktop && !fullPage)
      animate(scrim, [{ opacity: scrimOpacity }, { opacity: open ? 1 : 0 }]);
  });
  useLayoutEffect(() => {
    const animations = running.current;
    const reset = () => {
      for (const [element, animation] of animations) {
        animation.cancel();
        element.style.visibility = '';
        element.removeAttribute('data-page-motion');
      }
      animations.clear();
      const node = ref.current;
      previous.current = node
        ? {
            node,
            open: !!node.parentElement?.classList.contains('with-sidebar'),
            desktop: matchMedia('(min-width: 761px)').matches,
          }
        : undefined;
    };
    let width = window.innerWidth;
    const resize = () => {
      if (width === window.innerWidth) return;
      width = window.innerWidth;
      reset();
    };
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      reset();
    };
  }, []);
  return ref;
}

// A visible but stationary reveal: reading content must not slide around on
// navigation, and keyboard navigation must remain immediate.
export function animateContentChange(node: HTMLElement) {
  if (document.documentElement.dataset.motionInput === 'keyboard') return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  return node.animate([{ opacity: reduced ? 0.7 : 0 }, { opacity: 1 }], {
    duration: motionDuration(200),
    easing: getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim(),
  });
}

// Animate navigation identity, never live data updates or streaming tokens.
export function useContentMotion<T extends HTMLElement = HTMLElement>(identity: string) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const animation = animateContentChange(node);
    return () => animation?.cancel();
  }, [identity]);
  return ref;
}

// One bounded height transition for an explicit composer expansion. Ordinary
// typing and streamed content do not trigger measurements or delayed input.
export function useExpansionMotion(expanded: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef<{ expanded: boolean; height: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const before = previous.current;
    const height = node.getBoundingClientRect().height;
    previous.current = { expanded, height };
    const observer = new ResizeObserver(() => {
      if (previous.current?.expanded === expanded)
        previous.current.height = node.getBoundingClientRect().height;
    });
    observer.observe(node);
    let animation: Animation | undefined;
    if (
      before &&
      before.expanded !== expanded &&
      !matchMedia('(max-width: 760px)').matches &&
      motionDuration(280) > 100
    ) {
      animation = node.animate([{ height: `${before.height}px` }, { height: `${height}px` }], {
        duration: 280,
        easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
      });
    }
    return () => {
      observer.disconnect();
      animation?.cancel();
    };
  }, [expanded]);
  return ref;
}
