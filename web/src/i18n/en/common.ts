import { plural } from '../plural.ts';

const common = {
  'language.label': 'Language',
  'app.description': 'Connect to your computer and use Codex conversations on the go.',
  'remove.project.confirm': 'Remove “{{name}}”?',
  ...plural('skills.unreadable', {
    one: '{{count}} skill could not be read.',
    other: '{{count}} skills could not be read.',
  }),
  ...plural('files.changed', { one: '{{count}} file changed', other: '{{count}} files changed' }),
  'files.showMore': 'Show {{count}} more',
  ...plural('files.count', { one: '{{count}} file', other: '{{count}} files' }),
  ...plural('models.count', { one: '{{count}} model', other: '{{count}} models' }),
  ...plural('search.matches', {
    one: '{{count}} match · Searching loaded history only',
    other: '{{count}} matches · Searching loaded history only',
  }),
  'plan.progress': '· Completed {{done}}/{{total}} steps',
  'tool.used': 'Used {{server}}{{tool}}',
  'tool.fallback': 'tool',
  'task.duration': 'Worked for {{duration}}',
  'time.minutesSeconds': '{{minutes}}m {{seconds}}s',
  'offline.title': 'Network unavailable',
  'offline.description':
    'Reconnect to the network and open the app again. Conversations are saved on your computer; messages cannot be read or sent offline.',
} as const;

export default common;
