import type { Packet } from './bridge';

export const cursorNumber = (value: unknown): bigint | undefined =>
  typeof value === 'string' && /^\d{1,16}$/.test(value) ? BigInt(value) : undefined;

export class RebaseRequired extends Error {}

// A checkpoint belongs to the in-memory view, never to storage independently of
// that view. Reloading the document obtains a fresh baseline instead of skipping
// events using a persisted cursor whose associated messages no longer exist.
export class EventCheckpoint {
  cursor?: string;

  reset(cursor: string | undefined) {
    this.cursor = cursorNumber(cursor) === undefined ? undefined : cursor;
  }

  live(packets: Packet[], consume: (packets: Packet[]) => void) {
    let expected = cursorNumber(this.cursor);
    const ids = [
      ...new Set(
        packets
          .map((packet) => packet.eventId)
          .filter((id): id is string => cursorNumber(id) !== undefined),
      ),
    ]
      .map((id) => BigInt(id))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const id of ids) {
      if (expected !== undefined && id > expected + 1n) throw new RebaseRequired('Live event gap');
      if (expected === undefined || id > expected) expected = id;
    }
    this.apply(packets, consume);
  }

  apply(packets: Packet[], consume: (packets: Packet[]) => void) {
    const seen = new Set<string>();
    const before = cursorNumber(this.cursor);
    const ordered = packets
      .filter((packet) => {
        const id = cursorNumber(packet.eventId);
        if (id === undefined) return true;
        if ((before !== undefined && id <= before) || seen.has(packet.eventId!)) return false;
        seen.add(packet.eventId!);
        return true;
      })
      .sort((a, b) => {
        const left = cursorNumber(a.eventId),
          right = cursorNumber(b.eventId);
        return left !== undefined && right !== undefined
          ? left < right
            ? -1
            : left > right
              ? 1
              : 0
          : 0;
      });
    consume(ordered);
    // Advance only after the whole batch has been applied successfully.
    for (const packet of ordered) {
      const id = cursorNumber(packet.eventId);
      if (
        id !== undefined &&
        (cursorNumber(this.cursor) === undefined || id > cursorNumber(this.cursor)!)
      )
        this.cursor = packet.eventId;
    }
  }
}

export async function missedEvents(
  request: <T>(action: string, payload: Record<string, unknown>) => Promise<T>,
  from: string,
  through: string,
  current: () => boolean,
): Promise<Packet[]> {
  let cursor = from,
    bytes = 0;
  const events: Packet[] = [];
  const target = cursorNumber(through);
  if (target === undefined || cursorNumber(from) === undefined) throw new RebaseRequired();
  if (cursorNumber(from)! > target) throw new RebaseRequired();
  // Even an equal cursor is validated: retention may have advanced or the host
  // may have restored a different event log while retaining its identity.
  for (;;) {
    if (!current()) throw new Error('Connection cancelled');
    let page: { cursor: string; more: boolean; events: Packet[] };
    try {
      page = await request('events.replay', { cursor, limit: 256 });
    } catch (error) {
      if (/REPLAY_GAP/.test(String(error))) throw new RebaseRequired();
      throw error;
    }
    if (!Array.isArray(page.events) || cursorNumber(page.cursor) === undefined)
      throw new Error('Invalid event replay response');
    const next = cursorNumber(page.cursor)!;
    if (next < cursorNumber(cursor)! || (page.more && next === cursorNumber(cursor)!))
      throw new Error('Event replay did not advance');
    let previous = cursorNumber(cursor)!;
    for (const packet of page.events) {
      const id = cursorNumber(packet.eventId);
      if (packet.type !== 'event' || id === undefined || id <= previous || id > next)
        throw new Error('Invalid replay event order');
      previous = id;
    }
    if (
      (page.events.length && previous !== next) ||
      (!page.events.length && next !== cursorNumber(cursor)!)
    )
      throw new Error('Invalid replay checkpoint');
    events.push(...page.events);
    bytes += JSON.stringify(page.events).length;
    if (events.length > 2048 || bytes > 2 * 1024 * 1024) throw new RebaseRequired();
    cursor = page.cursor;
    if (next >= target) return events;
    if (!page.more) throw new RebaseRequired();
  }
}

export function changesDirectory(packet: Packet): boolean {
  const action = packet.action || '';
  if (
    (action === 'turn.progress' || action === 'upstream.progress') &&
    packet.payload?.method === 'turn/started'
  )
    return true;
  return /^(?:sessions?\.(?:created|updated|deleted|renamed|pinned|archived|restored|synced|historyChanged)|turn\.(?:queued|started|completed|failed|interrupted)|upstream\.turn\.completed|approvals?\.|projects?\.|devices?\.)/.test(
    action,
  );
}
