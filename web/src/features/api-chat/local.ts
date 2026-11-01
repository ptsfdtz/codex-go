import { t } from '../../i18n';
import type { ChatDetail, ChatSummary } from './client';
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
        reject(new Error(t('无法打开本地聊天存储')));
      };
      request.onblocked = () => {
        database = undefined;
        reject(new Error(t('本地聊天存储被其他页面占用，请关闭旧页面后重试')));
      };
    });
  return database;
}
export class LocalStore {
  constructor(readonly scope: string) {}
  // Read and write in one transaction: a stale tab must not overwrite recovery
  // or resurrect a deleted conversation, even before its broadcast arrives.
  private async changeChat(
    id: string,
    change: (current: ChatDetail | undefined) => ChatDetail | undefined,
  ): Promise<ChatDetail | undefined> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      const records = tx.objectStore('records');
      let result: ChatDetail | undefined;
      const deleted = records.get([this.scope, 'deleted', id]);
      deleted.onsuccess = () => {
        if (deleted.result) return;
        const current = records.get([this.scope, 'chat', id]);
        current.onsuccess = () => {
          result = change(current.result as ChatDetail | undefined);
          if (!result) return;
          const { title, providerId, model, effort, updatedAt } = result;
          const summary: ChatSummary = { id, title, providerId, model, effort, updatedAt };
          records.put(result, [this.scope, 'chat', id]);
          records.put(summary, [this.scope, 'summary', id]);
        };
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () =>
        reject(new Error(t('本地存储失败，请检查浏览器空间；当前内容已保留，请勿关闭页面')));
    });
  }
  saveChat(chat: ChatDetail) {
    return this.changeChat(chat.id, () => chat);
  }
  recoverChat(id: string) {
    return this.changeChat(id, (chat) => {
      if (!chat || !chat.messages.some((message) => message.status === 'running')) return chat;
      chat.uncertain = true;
      for (const message of chat.messages)
        if (message.status === 'running') {
          message.status = 'interrupted';
          if (message.role === 'assistant')
            message.error = t('页面关闭或连接中断，已有内容已保留；请求结果未知，不会自动重发。');
        }
      return chat;
    });
  }
  deleteChat(id: string) {
    return this.write([
      { kind: 'deleted', id, value: true },
      { kind: 'chat', id },
      { kind: 'summary', id },
    ]);
  }
  async read<T>(kind: string, id: string): Promise<T | undefined> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records');
      const request = tx.objectStore('records').get([this.scope, kind, id]);
      tx.oncomplete = () => resolve(request.result as T | undefined);
      tx.onabort = tx.onerror = () => reject(new Error(t('读取本地聊天失败')));
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
      tx.onabort = tx.onerror = () => reject(new Error(t('读取本地聊天失败')));
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
        reject(new Error(t('本地存储失败，请检查浏览器空间；当前内容已保留，请勿关闭页面')));
    });
  }
}
