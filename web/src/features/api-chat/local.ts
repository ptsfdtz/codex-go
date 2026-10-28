// This database contains local configuration and conversations, never API keys.
let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('agentdeck-agentchat', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records');
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        resolve(db);
      };
      request.onerror = () => {
        database = undefined;
        reject(new Error('无法打开本地聊天存储'));
      };
      request.onblocked = () => {
        database = undefined;
        reject(new Error('本地聊天存储被其他页面占用，请关闭旧页面后重试'));
      };
    });
  return database;
}
export class LocalStore {
  constructor(readonly scope: string) {}
  async read<T>(kind: string, id: string): Promise<T | undefined> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records');
      const request = tx.objectStore('records').get([this.scope, kind, id]);
      tx.oncomplete = () => resolve(request.result as T | undefined);
      tx.onabort = tx.onerror = () => reject(new Error('读取本地聊天失败'));
    });
  }
  async list<T>(kind: string): Promise<T[]> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records');
      const request = tx
        .objectStore('records')
        .getAll(IDBKeyRange.bound([this.scope, kind, ''], [this.scope, kind, '\uffff']));
      tx.oncomplete = () => resolve(request.result as T[]);
      tx.onabort = tx.onerror = () => reject(new Error('读取本地聊天失败'));
    });
  }
  async write(entries: { kind: string; id: string; value?: unknown }[]) {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      for (const entry of entries) {
        const key = [this.scope, entry.kind, entry.id];
        if (entry.value === undefined) tx.objectStore('records').delete(key);
        else tx.objectStore('records').put(entry.value, key);
      }
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(new Error('本地存储失败，请检查浏览器空间；当前内容已保留，请勿关闭页面'));
    });
  }
}
