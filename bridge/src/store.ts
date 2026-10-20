import Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Approval, DeckEvent, Project, Session, Status, Turn } from '@agentdeck/protocol';
import { DeckError, invariant } from './errors.js';
import { redact, redactValue } from './log.js';
import { approvalChoices } from './approval-contract.js';
import { retentionSettings } from '@agentdeck/protocol';

export const now = (): string => new Date().toISOString();
export const uid = (prefix: string): string => `${prefix}_${randomUUID()}`;
type Row = Record<string, unknown>;
export class Store extends EventEmitter {
  readonly db: Database.Database;
  constructor(filename: string) {
    super();
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, appliedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(projectId TEXT PRIMARY KEY,name TEXT NOT NULL,canonicalPath TEXT NOT NULL UNIQUE,identity TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(sessionId TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(projectId),upstreamThreadId TEXT NOT NULL UNIQUE,title TEXT NOT NULL,status TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS turns(turnId TEXT PRIMARY KEY,sessionId TEXT NOT NULL REFERENCES sessions(sessionId),upstreamTurnId TEXT,status TEXT NOT NULL,startedAt TEXT NOT NULL,endedAt TEXT,error TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS turn_upstream ON turns(sessionId,upstreamTurnId) WHERE upstreamTurnId IS NOT NULL;
      CREATE TABLE IF NOT EXISTS events(eventId INTEGER PRIMARY KEY AUTOINCREMENT,sessionId TEXT,turnId TEXT,seq INTEGER NOT NULL,action TEXT NOT NULL,payloadJson TEXT NOT NULL,ts TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_session ON events(sessionId,eventId);
      CREATE TABLE IF NOT EXISTS approvals(approvalId TEXT PRIMARY KEY,sessionId TEXT NOT NULL REFERENCES sessions(sessionId),turnId TEXT NOT NULL REFERENCES turns(turnId),method TEXT NOT NULL,status TEXT NOT NULL,contextJson TEXT NOT NULL,upstreamRequestJson TEXT NOT NULL,generation TEXT NOT NULL,createdAt TEXT NOT NULL,expiresAt TEXT NOT NULL,resolvedAt TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS approval_upstream ON approvals(generation,upstreamRequestJson);
      CREATE TABLE IF NOT EXISTS devices(deviceId TEXT PRIMARY KEY,displayName TEXT NOT NULL,credentialHash TEXT NOT NULL UNIQUE,createdAt TEXT NOT NULL,revokedAt TEXT);
      CREATE TABLE IF NOT EXISTS requests(deviceId TEXT NOT NULL,requestId TEXT NOT NULL,requestHash TEXT NOT NULL,status TEXT NOT NULL,responseJson TEXT,createdAt TEXT NOT NULL,PRIMARY KEY(deviceId,requestId));
      INSERT OR IGNORE INTO migrations(version,appliedAt) VALUES(1,datetime('now'));
      CREATE TABLE IF NOT EXISTS event_sequences(sessionKey TEXT PRIMARY KEY,seq INTEGER NOT NULL);
      INSERT OR IGNORE INTO event_sequences SELECT COALESCE(sessionId,''),MAX(seq) FROM events GROUP BY sessionId;
      INSERT OR IGNORE INTO migrations(version,appliedAt) VALUES(2,datetime('now'));
    `);
    if (!this.meta('hostId')) this.setMeta('hostId', uid('host'));
  }
  meta(key: string): string | undefined {
    return (
      this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as
        | { value: string }
        | undefined
    )?.value;
  }
  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run(key, value);
  }
  projects(): Project[] {
    return this.db
      .prepare(
        'SELECT projectId,name,canonicalPath,enabled,createdAt FROM projects WHERE enabled=1 ORDER BY name',
      )
      .all()
      .map((row) => ({ ...(row as Project), enabled: true }));
  }
  project(id: string): Row {
    const row = this.db
      .prepare('SELECT * FROM projects WHERE projectId=? AND enabled=1')
      .get(id) as Row | undefined;
    invariant(row, 'WORKSPACE_FORBIDDEN', 'Project is not locally authorized');
    return row;
  }
  sessions(projectId?: string): Session[] {
    return (
      projectId
        ? this.db
            .prepare('SELECT * FROM sessions WHERE projectId=? ORDER BY updatedAt DESC')
            .all(projectId)
        : this.db.prepare('SELECT * FROM sessions ORDER BY updatedAt DESC').all()
    ) as Session[];
  }
  session(id: string): Session {
    const session = this.db.prepare('SELECT * FROM sessions WHERE sessionId=?').get(id) as
      | Session
      | undefined;
    invariant(session, 'NOT_FOUND', 'Session not found');
    this.project(session.projectId);
    return session;
  }
  turns(sessionId?: string): Turn[] {
    return (
      sessionId
        ? this.db.prepare('SELECT * FROM turns WHERE sessionId=? ORDER BY startedAt').all(sessionId)
        : this.db
            .prepare(
              "SELECT * FROM turns WHERE status IN ('queued','running','waitingApproval','unknown') ORDER BY startedAt",
            )
            .all()
    ) as Turn[];
  }
  turn(id: string): Turn {
    const turn = this.db.prepare('SELECT * FROM turns WHERE turnId=?').get(id) as Turn | undefined;
    invariant(turn, 'NOT_FOUND', 'Turn not found');
    return turn;
  }
  setStatus(
    sessionId: string,
    turnId: string | null,
    status: Status,
    error: string | null = null,
  ): void {
    const ts = now();
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE sessions SET status=?,updatedAt=? WHERE sessionId=?')
        .run(status, ts, sessionId);
      if (turnId)
        this.db
          .prepare('UPDATE turns SET status=?,endedAt=?,error=? WHERE turnId=?')
          .run(
            status,
            ['completed', 'failed', 'interrupted'].includes(status) ? ts : null,
            error && redact(error),
            turnId,
          );
    })();
  }
  approvalRows(sessionId?: string): Row[] {
    return (
      sessionId
        ? this.db
            .prepare(
              "SELECT * FROM approvals WHERE sessionId=? AND status IN ('pending','sending') ORDER BY createdAt",
            )
            .all(sessionId)
        : this.db
            .prepare(
              "SELECT * FROM approvals WHERE status IN ('pending','sending') ORDER BY createdAt",
            )
            .all()
    ) as Row[];
  }
  publicApproval(row: Row): Approval {
    const context = JSON.parse(String(row.contextJson)) as Record<string, unknown>;
    return {
      approvalId: String(row.approvalId),
      sessionId: String(row.sessionId),
      turnId: String(row.turnId),
      method: String(row.method),
      status: String(row.status),
      context: redactValue(context) as Record<string, unknown>,
      createdAt: String(row.createdAt),
      expiresAt: String(row.expiresAt),
      allowedDecisions:
        row.status === 'pending' ? approvalChoices(String(row.method), context) : [],
    };
  }
  approvals(sessionId?: string): Approval[] {
    return this.approvalRows(sessionId).map((row) => this.publicApproval(row));
  }
  append(
    action: string,
    payload: unknown,
    sessionId: string | null = null,
    turnId: string | null = null,
  ): DeckEvent {
    const event = this.db.transaction(() => {
      const seq = (
        this.db
          .prepare(
            'INSERT INTO event_sequences(sessionKey,seq) VALUES(?,1) ON CONFLICT(sessionKey) DO UPDATE SET seq=seq+1 RETURNING seq',
          )
          .get(sessionId ?? '') as { seq: number }
      ).seq;
      const ts = now();
      let payloadJson = JSON.stringify(redactValue(payload));
      if (Buffer.byteLength(payloadJson) > 256 * 1024) {
        const source =
          payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
        payloadJson = JSON.stringify({
          truncated: true,
          originalBytes: Buffer.byteLength(payloadJson),
          method: source.method,
          delta:
            typeof source.delta === 'string' ? redact(source.delta.slice(0, 64000)) : undefined,
          turn:
            source.turn && typeof source.turn === 'object'
              ? {
                  turnId: (source.turn as Record<string, unknown>).turnId,
                  status: (source.turn as Record<string, unknown>).status,
                }
              : undefined,
          note: 'Event payload exceeded retained preview limit; inspect the workspace locally',
        });
      }
      const result = this.db
        .prepare(
          'INSERT INTO events(sessionId,turnId,seq,action,payloadJson,ts) VALUES(?,?,?,?,?,?)',
        )
        .run(sessionId, turnId, seq, action, payloadJson, ts);
      return {
        v: 1 as const,
        type: 'event' as const,
        eventId: String(result.lastInsertRowid),
        seq,
        sessionId,
        turnId,
        action,
        payload: JSON.parse(payloadJson) as unknown,
        ts,
      };
    })();
    this.emit('event', event);
    return event;
  }
  cursor(): string {
    return String(
      (this.db.prepare('SELECT COALESCE(MAX(eventId),0) AS id FROM events').get() as { id: number })
        .id,
    );
  }
  replay(cursor = '0', limit = 100): { events: DeckEvent[]; cursor: string; more: boolean } {
    invariant(
      /^\d{1,16}$/.test(cursor) && Number.isSafeInteger(Number(cursor)),
      'INVALID_REQUEST',
      'Invalid event cursor',
    );
    const floor = Number(this.meta('retentionFloor') ?? 0);
    if (Number(cursor) < floor || Number(cursor) > Number(this.cursor()))
      throw new DeckError('REPLAY_GAP', 'Cursor is outside retained history; request snapshot');
    const rows = this.db
      .prepare('SELECT * FROM events WHERE eventId>? ORDER BY eventId LIMIT ?')
      .all(Number(cursor), limit + 1) as Row[];
    const selected: Row[] = [];
    let bytes = 0;
    for (const row of rows.slice(0, limit)) {
      const length = Buffer.byteLength(String(row.payloadJson));
      if (selected.length && bytes + length > 512 * 1024) break;
      selected.push(row);
      bytes += length;
    }
    const events = selected.map((row) => this.event(row));
    return {
      events,
      cursor: events.at(-1)?.eventId ?? cursor,
      more: rows.length > selected.length,
    };
  }
  history(sessionId: string, before?: string, limit = 100): DeckEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE sessionId=? AND eventId<? ORDER BY eventId DESC LIMIT ?')
      .all(
        sessionId,
        before && /^\d+$/.test(before) ? Number(before) : Number.MAX_SAFE_INTEGER,
        limit,
      ) as Row[];
    const selected: Row[] = [];
    let bytes = 0;
    for (const row of rows) {
      const length = Buffer.byteLength(String(row.payloadJson));
      if (selected.length && bytes + length > 512 * 1024) break;
      selected.push(row);
      bytes += length;
    }
    return selected.reverse().map((row) => this.event(row));
  }
  private event(row: Row): DeckEvent {
    return {
      v: 1,
      type: 'event',
      eventId: String(row.eventId),
      seq: Number(row.seq),
      sessionId: row.sessionId as string | null,
      turnId: row.turnId as string | null,
      action: String(row.action),
      payload: JSON.parse(String(row.payloadJson)) as unknown,
      ts: String(row.ts),
    };
  }
  recover(): void {
    this.db.transaction(() => {
      this.db.prepare("UPDATE requests SET status='unknown' WHERE status='pending'").run();
      this.db
        .prepare(
          "UPDATE approvals SET status='expired',resolvedAt=? WHERE status IN ('pending','sending')",
        )
        .run(now());
      this.db
        .prepare(
          "UPDATE sessions SET status='unknown' WHERE status IN ('queued','running','waitingApproval')",
        )
        .run();
      this.db
        .prepare(
          "UPDATE turns SET status='unknown' WHERE status IN ('queued','running','waitingApproval')",
        )
        .run();
    })();
  }
  retention(): { days: number; maxMiB: number } {
    try {
      return retentionSettings.parse(
        JSON.parse(this.meta('retention') ?? '{"days":30,"maxMiB":256}'),
      );
    } catch {
      return { days: 30, maxMiB: 256 };
    }
  }
  setRetention(value: unknown): { days: number; maxMiB: number } {
    const settings = retentionSettings.parse(value);
    this.setMeta('retention', JSON.stringify(settings));
    this.append('settings.updated', { retention: settings });
    return settings;
  }
  diagnosticCounts(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const table of ['projects', 'sessions', 'turns', 'events', 'devices'])
      result[table] = (
        this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
      ).n;
    result.pendingApprovals = this.approvalRows().length;
    result.journalBytes = (
      this.db
        .prepare('SELECT COALESCE(SUM(length(CAST(payloadJson AS BLOB))),0) AS n FROM events')
        .get() as { n: number }
    ).n;
    return result;
  }
  retain(days = this.retention().days, maxBytes = this.retention().maxMiB * 1024 * 1024): void {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    this.db.transaction(() => {
      const floor = this.db
        .prepare('SELECT MAX(eventId) AS id FROM events WHERE ts<?')
        .get(cutoff) as { id: number | null };
      if (floor.id) {
        this.db.prepare('DELETE FROM events WHERE eventId<=?').run(floor.id);
        this.setMeta('retentionFloor', String(floor.id));
      }
      let bytes = (
        this.db
          .prepare('SELECT COALESCE(SUM(length(CAST(payloadJson AS BLOB))),0) AS n FROM events')
          .get() as { n: number }
      ).n;
      while (bytes > maxBytes) {
        const count = (this.db.prepare('SELECT count(*) AS n FROM events').get() as { n: number })
          .n;
        const last = this.db
          .prepare('SELECT eventId FROM events ORDER BY eventId LIMIT 1 OFFSET ?')
          .get(Math.max(0, Math.ceil(count * 0.25) - 1)) as { eventId: number } | undefined;
        if (last) {
          this.db.prepare('DELETE FROM events WHERE eventId<=?').run(last.eventId);
          this.setMeta('retentionFloor', String(last.eventId));
        } else break;
        bytes = (
          this.db
            .prepare('SELECT COALESCE(SUM(length(CAST(payloadJson AS BLOB))),0) AS n FROM events')
            .get() as { n: number }
        ).n;
      }
      this.db.prepare('DELETE FROM requests WHERE createdAt<?').run(cutoff);
    })();
  }
  close(): void {
    this.db.close();
  }
}
