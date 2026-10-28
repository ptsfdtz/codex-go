export type Host = {
  customName?: string | null;
  customNameConfigured?: boolean;
  cloudDeviceId?: string;
  hostId: string;
  displayName: string;
  online: boolean;
};
export const chatProject = 'agentdeck-chat';
export type Device = { deviceId: string; kind: string; displayName: string; revoked?: boolean };
export type Model = {
  id?: string;
  model?: string;
  name?: string;
  displayName?: string;
  description?: string;
  defaultReasoningEffort?: string;
  isDefault?: boolean;
  supportedReasoningEfforts?: (string | { reasoningEffort: string; description?: string })[];
};
export type Project = { projectId: string; name: string; canonicalPath?: string };
export type Session = {
  sessionId: string;
  title?: string;
  projectId?: string;
  upstreamThreadId?: string;
  updatedAt?: string;
  status?: string;
  archived?: number;
  pinned?: number;
  model?: string;
  effort?: string;
  upstream?: Record<string, unknown>;
};
export type Turn = {
  turnId?: string;
  upstreamTurnId?: string;
  sessionId?: string;
  status?: string;
};
export type Approval = {
  approvalId: string;
  sessionId: string;
  turnId: string;
  method?: string;
  context?: Record<string, unknown>;
  allowedDecisions?: string[];
  expiresAt?: string;
  status?: string;
};
export type Snapshot = {
  cursor?: string;
  host?: { codexVersion?: string };
  sessions?: Session[];
  projects?: Project[];
  turns?: Turn[];
  approvals?: Approval[];
};
export type Capabilities = {
  features?: Record<string, boolean>;
  codexVersion?: string;
  limits?: Record<string, number>;
};
export type Request = <T = Record<string, unknown>>(
  action: string,
  payload?: Record<string, unknown>,
) => Promise<T>;
export type Skill = {
  id: string;
  name: string;
  displayName?: string;
  shortDescription?: string;
  description?: string;
  enabled: boolean;
  scope?: string;
};
export type Attachment = {
  name: string;
  data: string;
  bytes: number;
  mime: string;
  originalBytes?: number;
};
export type Draft = {
  text: string;
  attachments: Attachment[];
  skills: Skill[];
  mode: string;
  model: string;
  effort: string;
};
export const emptyDraft = (): Draft => ({
  text: '',
  attachments: [],
  skills: [],
  mode: 'default',
  model: '',
  effort: '',
});
export function isSessionWorking(session: Session) {
  const nativeStatus = session.upstream?.status as { type?: string } | undefined;
  // Automatically consumed native queue entries have no managed local turn.
  // Their local status may be unknown while the native thread is active.
  return (
    ['running', 'inProgress'].includes(session.status || '') || nativeStatus?.type === 'active'
  );
}
export function canManage(session?: Session) {
  return (
    !!session && !['queued', 'running', 'waitingApproval', 'unknown'].includes(session.status || '')
  );
}
export function statusLabel(status?: string) {
  return (
    (
      {
        inProgress: 'Running',
        running: 'Running',
        waitingApproval: 'Needs approval',
        queued: 'Queued',
        unknown: 'Needs reconciliation',
        completed: 'Completed',
        failed: 'Failed',
        interrupted: 'Stopped',
        idle: 'Ready',
      } as Record<string, string>
    )[status || ''] ||
    status ||
    ''
  );
}
export const output = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);
