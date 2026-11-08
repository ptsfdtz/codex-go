import { t } from './i18n';
// Web Locks are released by the browser when a tab closes or crashes.
// Never substitute a localStorage lease: it cannot make receipt writes atomic.
export async function exclusive<T>(name: string, work: () => Promise<T>): Promise<T> {
  if (!globalThis.navigator?.locks)
    return Promise.reject(
      new Error(
        globalThis.isSecureContext === false
          ? t('请通过 HTTPS 打开 AgentDeck。局域网 HTTP 页面无法使用安全登录所需的 Web Locks。')
          : t('此浏览器不支持安全的多标签页协调，请更新浏览器后重试。'),
      ),
    );
  return await navigator.locks.request(`agentdeck.web.${name}`, work);
}
