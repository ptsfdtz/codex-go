import { api } from '../cloud';
import { t } from '../i18n';
import type { HostGrant } from './host';

export async function getHostGrant(hostId: string) {
  const grant = await api<HostGrant>('/api/v1/hosts/' + encodeURIComponent(hostId) + '/access', {
    method: 'POST',
  });
  if (
    grant.hostId !== hostId ||
    !/^[a-f0-9]{64}$/i.test(grant.fingerprint) ||
    !/^[A-Za-z0-9_-]{43}$/.test(grant.credential)
  )
    throw new Error(t('电脑授权信息无效，请更新 Host'));
  return grant;
}
