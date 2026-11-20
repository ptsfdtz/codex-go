import { t } from '../../i18n';

export type AttentionRoute = {
  accountId: string;
  hostId: string;
  sessionId: string;
  approvalId?: string;
};
export type AttentionDestination = AttentionRoute | 'inbox';

export function attentionRoute(value: unknown): AttentionDestination {
  if (!value || typeof value !== 'object') return 'inbox';
  const { accountId, hostId, sessionId, approvalId } = value as Partial<AttentionRoute>;
  const valid = (id: unknown): id is string =>
    typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id);
  if (!valid(accountId) || !valid(hostId) || !valid(sessionId)) return 'inbox';
  return { accountId, hostId, sessionId, ...(valid(approvalId) ? { approvalId } : {}) };
}
export function notificationLocation() {
  if (location.hash.startsWith('#attention?'))
    return attentionRoute(Object.fromEntries(new URLSearchParams(location.hash.slice(11))));
}

export function approvalNotice(status: string) {
  switch (status) {
    case 'pending':
      return '';
    case 'approved':
      return t('这项请求已获批准。');
    case 'rejected':
      return t('这项请求已被拒绝。');
    case 'cancelled':
      return t('这项请求已取消。');
    case 'expired':
      return t('这项请求已过期。');
    case 'resolved':
      return t('这项请求已处理。');
    case 'sending':
      return t('电脑正在处理这项请求。');
    default:
      return t('暂时无法确认这项请求的处理结果。');
  }
}
