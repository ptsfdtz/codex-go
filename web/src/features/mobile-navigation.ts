import { useLayoutEffect, useRef, useState } from 'react';

export type MobileView = {
  page: 'list' | 'conversation' | 'tools';
  session?: string;
  project?: string;
  toolTab?: string;
  manage?: string;
  panel?: string;
  menu?: 'workspace' | 'conversation';
};
type Entry = { owner: string; view: MobileView; previous?: MobileView; overlay?: number };
type HistoryState = { agentdeckMobile?: Entry };
const state = () => (window.history.state || {}) as HistoryState;
const equal = (a?: MobileView, b?: MobileView) => JSON.stringify(a) === JSON.stringify(b);
const lastPageKey = (owner: string) => 'agentdeck.web.mobile-page.' + owner;
const layerSelector = 'dialog[open]:not(.main-panel-modal):not([inert]), :popover-open';
function rememberPage(owner: string, view: MobileView) {
  try {
    localStorage.setItem(lastPageKey(owner), view.page === 'list' ? 'list' : 'conversation');
  } catch {
    /* History still works for the current page. */
  }
}

// Keep IDs in this tab's history.state. An entry never dispatches a Host
// operation. Resolving the view against current authorization is the caller's job.
export function useMobileNavigation(
  owner: string | undefined,
  view: MobileView,
  restore: (view: MobileView) => void,
  root: React.RefObject<HTMLElement | null>,
  lastConversation?: MobileView,
) {
  const latest = useRef({ view, restore, lastConversation });
  latest.current = { view, restore, lastConversation };
  const appliedRevision = useRef(0);
  const nextRevision = useRef(0);
  const navigatingBack = useRef(false);
  const fromDesktop = useRef(!matchMedia('(max-width:760px)').matches);
  const [revision, setRevision] = useState(0);
  const signature = JSON.stringify(view);
  useLayoutEffect(() => {
    if (!owner) {
      if (!matchMedia('(max-width:760px)').matches) fromDesktop.current = true;
      return;
    }
    const browser = window.history;
    function apply(entry?: Entry) {
      latest.current.restore(entry && entry.owner === owner ? entry.view : { page: 'list' });
      setRevision(++nextRevision.current);
    }
    const layers = () =>
      Array.from(root.current?.querySelectorAll<HTMLElement>(layerSelector) || []);
    const layerChanges = new MutationObserver(syncLayers);
    function pop(event: PopStateEvent) {
      navigatingBack.current = false;
      const record = (event.state as HistoryState | null)?.agentdeckMobile;
      const open = layers();
      const overlay = open.at(-1);
      if (overlay && open.length > (record?.overlay || 0)) {
        if (overlay instanceof HTMLDialogElement)
          overlay.dispatchEvent(new Event('cancel', { cancelable: true }));
        else overlay.hidePopover();
      }
      apply(record);
    }
    function syncLayers() {
      const entry = state().agentdeckMobile;
      if (!entry || entry.owner !== owner || navigatingBack.current) return;
      const open = layers();
      layerChanges.disconnect();
      for (const node of open)
        layerChanges.observe(node, { attributes: true, attributeFilter: ['open', 'inert'] });
      const depth = entry.overlay || 0;
      if (open.length > depth) {
        for (let level = depth + 1; level <= open.length; level++)
          browser.pushState({ ...state(), agentdeckMobile: { ...entry, overlay: level } }, '');
      } else if (open.length < depth) {
        navigatingBack.current = true;
        browser.go(open.length - depth);
      }
    }
    function toggle(event: Event) {
      if (event.target instanceof HTMLElement && event.target.matches('dialog, [popover]'))
        syncLayers();
    }
    const entry = state().agentdeckMobile;
    if (fromDesktop.current) {
      // The desktop may have switched sessions since the last narrow layout.
      // Start a fresh list → current view chain instead of replaying stale IDs.
      fromDesktop.current = false;
      const base: MobileView = { page: 'list' };
      browser.replaceState({ ...state(), agentdeckMobile: { owner, view: base } }, '');
      if (!equal(base, latest.current.view))
        browser.pushState(
          { ...state(), agentdeckMobile: { owner, view: latest.current.view, previous: base } },
          '',
        );
    } else if (entry?.owner === owner) apply(entry);
    else {
      const base = latest.current.view;
      browser.replaceState({ ...state(), agentdeckMobile: { owner, view: base } }, '');
      // The last page is a display preference only. Authorized IDs come from
      // the existing Host selection, which has already checked its snapshot.
      try {
        const restored = latest.current.lastConversation;
        if (
          base.page === 'list' &&
          restored &&
          localStorage.getItem(lastPageKey(owner)) === 'conversation'
        ) {
          const next = { owner, view: restored, previous: base };
          browser.pushState({ ...state(), agentdeckMobile: next }, '');
          apply(next);
        }
      } catch {
        /* A restricted browser starts on the list. */
      }
    }
    window.addEventListener('popstate', pop);
    document.addEventListener('toggle', toggle, true);
    return () => {
      window.removeEventListener('popstate', pop);
      document.removeEventListener('toggle', toggle, true);
      layerChanges.disconnect();
      navigatingBack.current = false;
      appliedRevision.current = nextRevision.current;
    };
  }, [owner, root]);
  useLayoutEffect(() => {
    if (!owner || navigatingBack.current) return;
    const browser = window.history;
    const entry = state().agentdeckMobile;
    // A restored destination may have become unavailable, e.g. after deletion.
    // A render after restore records whichever authorized view actually opened.
    if (revision !== nextRevision.current) return;
    if (appliedRevision.current !== revision) {
      appliedRevision.current = revision;
      browser.replaceState(
        {
          ...state(),
          agentdeckMobile: {
            owner,
            view: latest.current.view,
            previous: entry?.owner === owner ? entry.previous : undefined,
            overlay: root.current?.querySelectorAll(layerSelector).length || undefined,
          },
        },
        '',
      );
      rememberPage(owner, latest.current.view);
      return;
    }
    if (!entry || entry.owner !== owner || equal(entry.view, latest.current.view)) return;
    if (equal(entry.previous, latest.current.view) && !entry.overlay) {
      navigatingBack.current = true;
      browser.back();
      return;
    }
    // Choosing a destination from a menu replaces that transient entry.
    const replace = entry.overlay || (entry.view.menu && !latest.current.view.menu);
    const next: Entry = {
      owner,
      view: latest.current.view,
      previous: replace ? entry.previous : entry.view,
    };
    rememberPage(owner, next.view);
    if (replace) browser.replaceState({ ...state(), agentdeckMobile: next }, '');
    else browser.pushState({ ...state(), agentdeckMobile: next }, '');
  }, [signature, owner, revision, root]);
}
