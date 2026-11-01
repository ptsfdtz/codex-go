import type { Bridge } from './transport/bridge';
import type { HistoryEntry, HistoryPage } from './history';

export async function readHistoryPage(
  connection: Bridge,
  sessionId: string,
  cursor?: string,
  cache = new Map<string, HistoryEntry>(),
): Promise<HistoryPage & { data: HistoryEntry[] }> {
  const page = await connection.request<HistoryPage>('sessions.history', {
    sessionId,
    ...(cursor ? { cursor } : {}),
    limit: 50,
    sortDirection: 'desc',
  });
  const data = [...(page.data || [])];
  const resource = page.resource;
  if (!resource) return { ...page, data };
  const total = resource.bytes || 0;
  if (
    total < 1 ||
    total > 8 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/i.test(resource.sha256 || '') ||
    (resource.cursor !== null &&
      resource.cursor !== undefined &&
      typeof resource.cursor !== 'string')
  )
    throw new Error('电脑返回了无效的历史资源描述');
  const cacheKey = `${sessionId}:${resource.sha256!.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return { ...page, data: [...data, cached] };
  const bytes = new Uint8Array(total);
  let offset = 0;
  while (offset < total) {
    const chunk = await connection.request<{
      data?: string;
      offset?: number;
      totalBytes?: number;
      nextOffset?: number;
    }>('sessions.historyContent', {
      sessionId,
      ...(typeof resource.cursor === 'string' ? { cursor: resource.cursor } : {}),
      sha256: resource.sha256,
      offset,
      sortDirection: 'desc',
    });
    if (chunk.offset !== offset || chunk.totalBytes !== total || typeof chunk.data !== 'string')
      throw new Error('历史资源分块无效');
    const binary = atob(chunk.data);
    if (!binary.length || binary.length > 64 * 1024 || offset + binary.length > total)
      throw new Error('历史资源分块超出限制');
    for (let index = 0; index < binary.length; index++)
      bytes[offset + index] = binary.charCodeAt(index);
    const next = chunk.nextOffset ?? total;
    if (next !== offset + binary.length || next <= offset) throw new Error('历史资源 offset 无效');
    offset = next;
  }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  if (digest.toLowerCase() !== resource.sha256!.toLowerCase()) throw new Error('历史资源校验失败');
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as HistoryEntry;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !parsed.item ||
    (resource.turnId && parsed.turnId !== resource.turnId) ||
    (resource.itemId && parsed.item.id !== resource.itemId)
  )
    throw new Error('历史资源内容无效');
  if (cache.size >= 4) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(cacheKey, parsed);
  data.push(parsed);
  return { ...page, data };
}
