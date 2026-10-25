import type { ReactNode } from 'react';
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
  { id: 'general', name: '常规', icon: Settings, description: '调整外观、通知和应用偏好。' },
  {
    id: 'configuration',
    name: '模型与输出',
    icon: SlidersHorizontal,
    description: '管理所连接电脑的默认模型与回复方式。',
  },
  {
    id: 'conversations',
    name: '对话',
    icon: History,
    description: '找回归档、查看草稿或同步已有对话。',
  },
  { id: 'shortcuts', name: '快捷键', icon: Keyboard, description: '使用键盘更快地操作会话。' },
  { id: 'computers', name: '电脑', icon: Computer, description: '查看并切换你的电脑连接。' },
  { id: 'data', name: '数据', icon: Database, description: '管理所连接电脑的缓存与保留策略。' },
  { id: 'diagnostics', name: '诊断', icon: FileText, description: '检查电脑连接与运行状态。' },
  {
    id: 'account',
    name: 'Codex 账户',
    icon: UserRound,
    description: '查看所连接电脑的 Codex 账户信息。',
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
  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分类">
        {categories.map(({ id, name, icon: Icon }) => (
          <button
            key={id}
            className={active === id ? 'active' : ''}
            aria-current={active === id ? 'page' : undefined}
            aria-controls="settings-content"
            onClick={() => onChange(id)}
          >
            <Icon size={18} />
            <span>{name}</span>
          </button>
        ))}
      </nav>
      <section
        className="settings-body"
        id="settings-content"
        aria-labelledby="settings-heading"
        key={active}
      >
        <header className="settings-heading">
          <h2 id="settings-heading">{category.name}</h2>
          <p>{category.description}</p>
        </header>
        {children}
      </section>
    </div>
  );
}
