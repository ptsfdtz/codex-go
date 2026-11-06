import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { Draft } from '../workspace';

type Drafts = Record<string, Draft>;
// Work-mode navigation unmounts its view. Keep unsent Codex inputs in this
// page's memory, scoped by authenticated account/device, for the tab lifetime.
// This does not persist messages or attachments to browser storage.
const pageDrafts = new Map<string, Drafts>();
const empty: Drafts = {};

export function usePageDrafts(scope: string): [Drafts, Dispatch<SetStateAction<Drafts>>] {
  const [byScope, setByScope] = useState(() => new Map(pageDrafts));
  const owner = useRef(scope);
  owner.current = scope;
  const drafts = byScope.get(scope) || empty;
  const setDrafts = useCallback<Dispatch<SetStateAction<Drafts>>>((update) => {
    const target = owner.current;
    setByScope((current) => {
      const before = current.get(target) || empty;
      const next = typeof update === 'function' ? update(before) : update;
      return new Map(current).set(target, next);
    });
  }, []);
  useLayoutEffect(() => {
    if (scope) pageDrafts.set(scope, drafts);
  }, [scope, drafts]);
  return [drafts, setDrafts];
}
