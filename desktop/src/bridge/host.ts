import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
export interface Project {
  projectId: string;
  name: string;
  canonicalPath: string;
}
export interface Device {
  deviceId: string;
  displayName: string;
  connected: boolean;
}
export interface Approval {
  approvalId: string;
  sessionId: string;
  turnId: string;
  sessionTitle?: string;
  method: string;
  status: string;
  context: Record<string, unknown>;
  expiresAt: string;
  allowedDecisions: string[];
}
export interface HostState {
  codexReady: boolean;
  sandboxVerified: boolean;
  endpoint?: string;
  listenAddress?: string;
  lastWorkspaceSync?: string;
  projects: Project[];
  devices: Device[];
  approvals: Approval[];
  addresses: string[];
}
export interface Invitation {
  image: string;
  endpoint: string;
  fingerprint: string;
  expiresAt: string;
}
export interface Pairing {
  requestId: string;
  displayName: string;
  code: string;
  expiresAt: string;
}
export interface View {
  revision: number;
  state: HostState;
  qr: Invitation | null;
  pairing: Pairing | null;
  errorCode: string | null;
  error: string | null;
  running: boolean;
}
export const emptyView: View = {
  revision: -1,
  state: {
    codexReady: false,
    sandboxVerified: false,
    projects: [],
    devices: [],
    approvals: [],
    addresses: [],
  },
  qr: null,
  pairing: null,
  errorCode: null,
  error: null,
  running: false,
};
export type Action =
  | { action: 'workspaces.sync' }
  | { action: 'pair.create'; address: string }
  | { action: 'pair.confirm'; requestId: string; approve: boolean }
  | { action: 'device.revoke'; deviceId: string }
  | { action: 'project.remove'; projectId: string }
  | {
      action: 'approval.decide';
      approvalId: string;
      sessionId: string;
      turnId: string;
      decision: 'approve' | 'reject' | 'cancel';
    };
export interface LocalRequest {
  type: 'project.addRequest' | 'project.removeRequest';
  payload: { projectId?: string };
}
export const host = {
  snapshot: () => invoke<View>('host_snapshot'),
  subscribe: (callback: (view: View) => void) =>
    listen<View>('host-view', (event) => callback(event.payload)),
  localRequests: (callback: (request: LocalRequest) => void) =>
    listen<LocalRequest>('local-request', (event) => callback(event.payload)),
  action: (action: Action) => invoke('host_action', { action }),
  restart: () => invoke('host_restart'),
  installSupportedCodex: () => invoke<string>('install_supported_codex'),
  pickProject: () => invoke('pick_project'),
  quit: () => invoke('quit_app'),
};
