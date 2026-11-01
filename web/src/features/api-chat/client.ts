import { t } from '../../i18n';
import { api } from '../../cloud';
import { LocalStore } from './local';
export type Provider = {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  modelEfforts?: Record<string, string[]>;
  hasKey: boolean;
  keyId?: string;
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
  status: 'complete' | 'running' | 'stopped' | 'failed' | 'interrupted';
  error?: string;
};
export type ChatDetail = ChatSummary & { messages: ChatMessage[]; uncertain?: boolean };
const keyApi = <T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) =>
  api<T>('/api/v1/chat/keys' + path, {
    method,
    cache: 'no-store',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
export const keyStatus = () => keyApi<{ enabled: boolean }>('');
export async function getKey(id: string, signal?: AbortSignal) {
  const value = await keyApi<{ apiKey: string }>(
    `/${encodeURIComponent(id)}/reveal`,
    'POST',
    undefined,
    signal,
  );
  return value.apiKey;
}
export function baseUrl(value: string) {
  const url = new URL(value.trim().replace(/\/+$/, ''));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error(t('请填写 HTTPS 接口地址'));
  return url.toString().replace(/\/+$/, '');
}
export async function saveProvider(scope: string, provider: Provider, key: string, old?: Provider) {
  const base = baseUrl(provider.baseUrl);
  if (old && old.baseUrl !== base && !key) throw new Error(t('更换接口地址时请重新填写 API Key'));
  if (!old && !key.trim()) throw new Error(t('请填写 API Key'));
  if (!provider.models.length || provider.models.length > 512)
    throw new Error(t('请填写 1–512 个模型'));
  for (const model of provider.models)
    if (!model.trim() || model.length > 160 || Array.from(model).some((c) => c.charCodeAt(0) < 32))
      throw new Error(t('模型名称无效'));
  const allowed = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  for (const values of Object.values(provider.modelEfforts || {}))
    if (values.length > 8 || values.some((value) => !allowed.includes(value)))
      throw new Error(t('思考强度档位无效'));
  const oldKey = old?.keyId || old?.id;
  const keyId = key ? crypto.randomUUID() : oldKey!;
  if (key) await keyApi(`/${keyId}`, 'PUT', { apiKey: key });
  try {
    await new LocalStore(scope).write([
      {
        kind: 'provider',
        id: provider.id,
        value: { ...provider, baseUrl: base, hasKey: true, keyId },
      },
    ]);
  } catch (error) {
    if (key) await keyApi(`/${keyId}`, 'DELETE').catch(() => {});
    throw error;
  }
  // Rotating the slot prevents a stale tab from using a new key with an old URL.
  if (key && oldKey) await keyApi(`/${oldKey}`, 'DELETE').catch(() => {});
}
export async function deleteProvider(scope: string, id: string) {
  const store = new LocalStore(scope),
    provider = await store.read<Provider>('provider', id);
  await keyApi(`/${provider?.keyId || id}`, 'DELETE');
  await store.write([{ kind: 'provider', id }]);
}
export class ProviderHttpError extends Error {}
export async function providerFetch(base: string, path: string, key: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(baseUrl(base) + path, {
      ...init,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: {
        Authorization: `Bearer ${key}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new Error(t('无法直连接口，请检查网络及供应商的跨域访问（CORS）设置'));
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderHttpError(
      response.status === 401 || response.status === 403
        ? t('API Key 无效或没有模型权限')
        : response.status === 429
          ? t('接口额度或速率受限')
          : t('接口请求失败（{{p0}}）', { p0: response.status }),
    );
  }
  return response;
}
export async function discoverModels(
  base: string,
  key: string,
  provider: Provider | undefined,
  signal: AbortSignal,
) {
  const canonical = baseUrl(base);
  if (!key && provider?.baseUrl !== canonical)
    throw new Error(t('更换接口地址时请重新填写 API Key'));
  const token = key || (await getKey(provider!.keyId || provider!.id, signal));
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  const response = await providerFetch(canonical, '/models', token, { signal: timeout });
  const value = JSON.parse(await readLimited(response, 1024 * 1024));
  if (!Array.isArray(value.data)) throw new Error(t('接口不支持获取模型，请手动填写'));
  const models = [
    ...new Set<string>(
      value.data
        .map((m: { id?: unknown }) => m?.id)
        .filter(
          (id: unknown): id is string =>
            typeof id === 'string' &&
            !!id.trim() &&
            id.length <= 160 &&
            !Array.from(id).some(
              (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
            ),
        ),
    ),
  ].sort();
  if (!models.length || models.length > 512)
    throw new Error(t('没有可用模型或模型过多，请手动填写'));
  return models;
}
async function readLimited(response: Response, limit: number) {
  if (!response.body) throw new Error(t('接口未返回内容'));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '',
    size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error(t('接口返回内容过大'));
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
// Text delta/terminal handling follows the MIT NextChat reference in third_party/nextchat.
export async function streamCompletion(
  response: Response,
  signal: AbortSignal,
  onText: (text: string) => void | Promise<void>,
) {
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body)
    throw new Error(t('接口未返回流式回复'));
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    text = '',
    done = false,
    pendingCR = false,
    size = 0;
  async function event(block: string) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    if (data.trim() === '[DONE]') {
      done = true;
      return;
    }
    const value = JSON.parse(data);
    if (value.error) throw new Error(t('供应商生成失败，已有内容已保留'));
    const choice = value.choices?.[0];
    const delta = choice?.delta?.content;
    if (typeof delta === 'string') {
      text += delta;
      size += new TextEncoder().encode(delta).length;
      if (size > 512 * 1024) throw new Error(t('回复超过 512 KiB，已停止'));
      await onText(text);
    }
    if (choice?.finish_reason) {
      if (choice.finish_reason !== 'stop' && choice.finish_reason !== 'length')
        throw new Error(t('供应商未完成回复'));
      done = true;
    }
  }
  try {
    while (!done && !signal.aborted) {
      const part = await reader.read().catch((error: unknown) => {
        if (signal.aborted) throw error;
        throw new Error(t('回复连接中断，已有内容已保留；请勿自动重发'));
      });
      if (part.done) {
        buffer += decoder.decode();
        if (buffer.trim()) await event(buffer);
        break;
      }
      let value = decoder.decode(part.value, { stream: true });
      if (pendingCR && value.startsWith('\n')) value = value.slice(1);
      pendingCR = value.endsWith('\r');
      buffer += value.replace(/\r\n?/g, '\n');
      if (buffer.length > 1024 * 1024) throw new Error(t('接口流式数据过大'));
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        await event(block);
        if (done) break;
      }
    }
    if (!done && !signal.aborted) throw new Error(t('回复连接中断，已有内容已保留；请勿自动重发'));
    if (!text && !signal.aborted) throw new Error(t('供应商未返回文字回复'));
    return text;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
