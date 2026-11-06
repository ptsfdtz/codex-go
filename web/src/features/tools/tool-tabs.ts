import { useState } from 'react';
import type { Tool } from './ToolsNavigation';

export type ToolTab = {
  id: string;
  tool?: Tool;
  projectId: string;
  path?: string;
  sessionId?: string;
  openToken: number;
};

export function useToolTabs(owner: string) {
  const [stored, setStored] = useState<{ owner: string; tabs: ToolTab[]; active: string }>({
    owner,
    tabs: [],
    active: '',
  });
  // Changing account or Host must never expose another owner's mounted tools.
  const state = stored.owner === owner ? stored : { owner, tabs: [], active: '' };
  const update = (change: (current: typeof state) => typeof state) =>
    setStored((current) =>
      change(current.owner === owner ? current : { owner, tabs: [], active: '' }),
    );
  const newTab = () => {
    const tab: ToolTab = { id: crypto.randomUUID(), projectId: '', openToken: 0 };
    update((current) => ({ ...current, tabs: [...current.tabs, tab], active: tab.id }));
  };
  function openTool(
    tool: Tool,
    projectId: string,
    path?: string,
    reuse = true,
    sessionId?: string,
  ) {
    const id = crypto.randomUUID();
    update((current) => {
      const active = current.tabs.find((tab) => tab.id === current.active);
      const existing =
        active &&
        (!active.tool || (reuse && active.tool === tool && active.projectId === projectId))
          ? active
          : reuse
            ? current.tabs.find((tab) => tab.tool === tool && tab.projectId === projectId)
            : undefined;
      const tab: ToolTab = {
        id: existing?.id || id,
        tool,
        projectId,
        path,
        sessionId,
        openToken: (existing?.openToken || 0) + 1,
      };
      return {
        ...current,
        active: tab.id,
        tabs: existing
          ? current.tabs.map((item) => (item.id === tab.id ? tab : item))
          : [...current.tabs, tab],
      };
    });
  }
  function closeTab(id: string) {
    update((current) => {
      const index = current.tabs.findIndex((tab) => tab.id === id);
      if (index < 0) return current;
      const tabs = current.tabs.filter((tab) => tab.id !== id);
      if (!tabs.length) tabs.push({ id: crypto.randomUUID(), projectId: '', openToken: 0 });
      return {
        ...current,
        tabs,
        active: current.active === id ? tabs[Math.min(index, tabs.length - 1)]!.id : current.active,
      };
    });
  }
  return {
    ...state,
    newTab,
    openTool,
    closeTab,
    selectTab: (active: string) => update((current) => ({ ...current, active })),
    activeTab: state.tabs.find((tab) => tab.id === state.active),
  };
}
