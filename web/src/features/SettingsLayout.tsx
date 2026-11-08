import { t, useLocale } from '../i18n';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { motionDuration } from '../motion';
import { Settings, Folder, Computer } from 'lucide-react';

const categories = [
  {
    id: 'general',
    get name() {
      return t('常规');
    },
    icon: Settings,
  },
  {
    id: 'conversations',
    get name() {
      return t('项目');
    },
    icon: Folder,
  },
  {
    id: 'computers',
    get name() {
      return t('电脑');
    },
    icon: Computer,
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
  useLocale();
  const category = categories.find(({ id }) => id === active) || categories[0]!;
  const index = categories.indexOf(category);
  const body = useRef<HTMLElement>(null);
  const previous = useRef(index);
  useLayoutEffect(() => {
    const node = body.current;
    if (!node) return;
    node.scrollTop = 0;
    const direction = Math.sign(index - previous.current);
    previous.current = index;
    if (!direction || document.documentElement.dataset.motionInput === 'keyboard') return;
    const duration = motionDuration(240);
    const animation = node.animate(
      [
        {
          opacity: duration <= 100 ? 0.7 : 0,
          transform: `translateX(${duration <= 100 ? 0 : direction * 12}px)`,
        },
        { opacity: 1, transform: 'translateX(0)' },
      ],
      {
        duration,
        easing: getComputedStyle(document.documentElement).getPropertyValue('--ease-drawer').trim(),
      },
    );
    return () => animation.cancel();
  }, [index]);
  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label={t('设置分类')}>
        <span
          className="settings-selection"
          aria-hidden="true"
          style={{ transform: `translateX(calc(${index * 100}% + ${index * 4}px))` }}
        />
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
