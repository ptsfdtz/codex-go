// Web Locks are released by the browser when a tab closes or crashes.
// Never substitute a localStorage lease: it cannot make receipt writes atomic.
export async function exclusive<T>(name: string, work: () => Promise<T>): Promise<T> {
  if (!globalThis.navigator?.locks)
    return Promise.reject(
      new Error('此浏览器不支持安全的多标签页协调，请使用新版 Edge、Chrome 或 Firefox'),
    );
  return await navigator.locks.request(`agentdeck.web.${name}`, work);
}
