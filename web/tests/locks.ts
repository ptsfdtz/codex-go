// Deterministic Web Locks fixture for Node 22. Real cross-tab lock release and
// takeover are separately exercised by browser-recovery.mjs in Edge.
export function testLocks() {
  const queues = new Map<string, Promise<unknown>>();
  return {
    request<T>(name: string, work: () => Promise<T>): Promise<T> {
      const result = (queues.get(name) || Promise.resolve()).catch(() => {}).then(work);
      queues.set(name, result);
      return result;
    },
  };
}
