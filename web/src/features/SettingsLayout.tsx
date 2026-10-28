import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { motionDuration } from '../motion';
import {
  Settings,
  SlidersHorizontal,
  History,
  Keyboard,
  Computer,
  Database,
  FileText,
  UserRound,
} from 'lucide-react';

const categories = [
  { id: 'general', name: '常规', icon: Settings },
  {
    id: 'configuration',
    name: '模型与输出',
    icon: SlidersHorizontal,
  },
  {
    id: 'conversations',
    name: '对话',
    icon: History,
  },
  { id: 'shortcuts', name: '快捷键', icon: Keyboard },
  { id: 'computers', name: '电脑', icon: Computer },
  { id: 'data', name: '数据', icon: Database },
  { id: 'diagnostics', name: '诊断', icon: FileText },
  {
    id: 'account',
    name: 'Codex 账户',
    icon: UserRound,
  },
];

export function SettingsLayout({
  active,
  onChange,
  children,
}: {
  active: string;
  onChange: (id: string) => void;
  children: ReactNode;
}) {
  const category = categories.find(({ id }) => id === active) || categories[0]!;
  const body = useRef<HTMLElement>(null);
  const nav = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = body.current;
    if (!node) return;
    node.scrollTop = 0;
    const selected = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const animation = node.animate([{ opacity: 0.65 }, { opacity: 1 }], {
      duration: motionDuration(180),
      easing: 'ease-out',
    });
    return () => animation.cancel();
  }, [active]);
  return (
    <div className="settings-layout">
      <nav ref={nav} className="settings-nav" aria-label="设置分类">
        {categories.map(({ id, name, icon: Icon }) => (
          <button
            key={id}
            aria-label={name}
            title={name}
            className={active === id ? 'active' : ''}
            aria-current={active === id ? 'page' : undefined}
            aria-controls="settings-content"
            onClick={() => onChange(id)}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{name}</span>
          </button>
        ))}
      </nav>
      <section
        ref={body}
        className="settings-body"
        id="settings-content"
        aria-labelledby="settings-heading"
      >
        <header className="settings-heading">
          <h2 id="settings-heading">{category.name}</h2>
        </header>
        {children}
      </section>
    </div>
  );
}
