import type en from '../en/common.ts';
import { plural } from '../plural.ts';

const common = {
  'language.label': '语言',
  'app.description': '在手机上连接电脑，操作 Codex 会话。',
  'remove.project.confirm': '移除“{{name}}”？',
  ...plural('skills.unreadable', { other: '有 {{count}} 个技能无法读取。' }),
  ...plural('files.changed', { other: '{{count}} 个文件已更改' }),
  'files.showMore': '再显示 {{count}} 个',
  ...plural('files.count', { other: '{{count}} 个文件' }),
  ...plural('models.count', { other: '{{count}} 个模型' }),
  ...plural('search.matches', { other: '{{count}} 条匹配 · 仅查找当前已加载历史' }),
  'plan.progress': '· 已完成 {{done}}/{{total}} 步',
  'tool.used': '使用了 {{server}}{{tool}}',
  'tool.fallback': '工具',
  'task.duration': '用时 {{duration}}',
  'time.minutesSeconds': '{{minutes}} 分 {{seconds}} 秒',
  'offline.title': '网络暂时不可用',
  'offline.description': '连接网络后重新打开。会话保存在电脑上，离线时无法读取或发送消息。',
} as const satisfies Record<keyof typeof en, string>;

export default common;
