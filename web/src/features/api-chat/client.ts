import { api, apiStream } from '../../cloud';
export type Provider = {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  modelEfforts?: Record<string, string[]>;
  hasKey: boolean;
};
export type ChatSummary = {
  id: string;
  title: string;
  providerId: string;
  model: string;
  effort?: string;
  updatedAt: string;
};
export type ChatMessage = {
  id: string;
  requestId: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'complete' | 'running' | 'failed' | 'stopped' | 'interrupted';
  error?: string;
};
export type ChatDetail = ChatSummary & { messages: ChatMessage[] };
export const chatApi = <T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) =>
  api<T>('/api/v1/chat' + path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });

export async function watchChat(
  id: string,
  signal: AbortSignal,
  onSnapshot: (value: ChatDetail) => void,
) {
  const response = await apiStream(
    `/api/v1/chat/conversations/${encodeURIComponent(id)}/events`,
    signal,
  );
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body)
    throw new Error('聊天流不可用，请刷新会话');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) throw new Error('回复连接已断开，请刷新会话查看结果');
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      if (buffer.length > 4 * 1024 * 1024) throw new Error('回复超过显示限制');
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (!event.split('\n').includes('event: snapshot')) continue;
        const data = event
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        const snapshot = JSON.parse(data) as ChatDetail;
        if (snapshot.id !== id || !Array.isArray(snapshot.messages))
          throw new Error('聊天会话身份不匹配');
        if (!signal.aborted) onSnapshot(snapshot);
        if (!snapshot.messages.some((message) => message.status === 'running')) return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
