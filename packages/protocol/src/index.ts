import { z } from 'zod';

export const VERSION = 1 as const;
export const id = z.string().min(1).max(160);
const empty = z.object({}).strict();
export const retentionSettings = z
  .object({ days: z.number().int().min(1).max(365), maxMiB: z.number().int().min(16).max(1024) })
  .strict();
const page = z
  .object({
    cursor: z.string().max(160).optional(),
    limit: z.number().int().min(1).max(500).default(100),
  })
  .strict();
export const payloads = {
  'system.hello': z.object({ client: z.string().max(100), version: z.literal(1) }).strict(),
  'system.capabilities': empty,
  'system.diagnostics': empty,
  'settings.get': empty,
  'settings.update': retentionSettings,
  'snapshot.get': empty,
  'projects.list': empty,
  'projects.add': empty,
  'projects.remove': z.object({ projectId: id }).strict(),
  'sessions.list': z.object({ projectId: id.optional() }).strict(),
  'sessions.create': z.object({ projectId: id, title: z.string().trim().min(1).max(160) }).strict(),
  'sessions.detail': z
    .object({
      sessionId: id,
      before: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    })
    .strict(),
  'turn.start': z.object({ sessionId: id, text: z.string().trim().min(1).max(64000) }).strict(),
  'turn.interrupt': z.object({ sessionId: id, turnId: id }).strict(),
  'approvals.list': z.object({ sessionId: id.optional() }).strict(),
  'approvals.decide': z
    .object({
      sessionId: id,
      turnId: id,
      approvalId: id,
      decision: z.enum(['approve', 'reject', 'cancel']),
    })
    .strict(),
  'git.status': z.object({ projectId: id }).strict(),
  'git.diff': z.object({ projectId: id, fileId: id }).strict(),
  'events.replay': page,
  'devices.revokeSelf': empty,
} as const;
export type Action = keyof typeof payloads;
export const requestSchema = z
  .object({
    v: z.literal(VERSION),
    type: z.literal('request'),
    id,
    action: z.enum(Object.keys(payloads) as [Action, ...Action[]]),
    projectId: id.optional(),
    sessionId: id.optional(),
    payload: z.unknown(),
    ts: z.string().datetime().optional(),
  })
  .strict();
export type Request = z.infer<typeof requestSchema>;
export function parseRequest(value: unknown): Request {
  const request = requestSchema.parse(value);
  request.payload = payloads[request.action].parse(request.payload);
  return request;
}
export type Status =
  | 'idle'
  | 'queued'
  | 'running'
  | 'waitingApproval'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'unknown';
export interface Project {
  projectId: string;
  name: string;
  canonicalPath: string;
  enabled: boolean;
  createdAt: string;
}
export interface Session {
  sessionId: string;
  projectId: string;
  upstreamThreadId: string;
  title: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
}
export interface Turn {
  turnId: string;
  sessionId: string;
  upstreamTurnId: string | null;
  status: Status;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
}
export interface Approval {
  approvalId: string;
  sessionId: string;
  turnId: string;
  method: string;
  status: string;
  context: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  allowedDecisions: string[];
}
export interface DeckEvent {
  v: 1;
  type: 'event';
  eventId: string;
  seq: number;
  sessionId: string | null;
  turnId: string | null;
  action: string;
  payload: unknown;
  ts: string;
}
export interface ErrorPacket {
  v: 1;
  type: 'error';
  id?: string;
  code: string;
  message: string;
  retryable: boolean;
}
export interface Response {
  v: 1;
  type: 'response';
  id: string;
  action: string;
  payload: unknown;
  ts: string;
}
export interface Snapshot {
  cursor: string;
  host: { hostId: string; status: string; codexVersion: string };
  projects: Project[];
  sessions: Session[];
  turns: Turn[];
  approvals: Approval[];
}
export const pairingQr = z
  .object({
    v: z.literal(1),
    endpoint: z
      .string()
      .url()
      .max(300)
      .refine((s) => s.startsWith('https://')),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    expiresAt: z.string().datetime(),
    hostId: id,
  })
  .strict();
export const pairingRequest = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    displayName: z.string().trim().min(1).max(80),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
