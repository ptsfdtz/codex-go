import { Desktop } from '../bridge/src/desktop.js';
import { createInterface } from 'node:readline';

// Isolated UI fixture. No network, project authorization, device credentials or Codex process.
const desktop = new Desktop();
const expiresAt = new Date(Date.now() + 300000).toISOString();
const fixture = {
  windowTitle: 'AgentDeck · 电脑端界面预览（隔离测试）',
  status: 'UI fixture — no real connection',
  endpoint: 'https://192.168.1.20:49321',
  listenAddress: '192.168.1.20',
  codexReady: true,
  sandboxVerified: true,
  projects: [
    {
      projectId: 'fixture-web',
      name: '网站项目',
      canonicalPath: 'C:\\Projects\\website',
      enabled: true,
    },
    {
      projectId: 'fixture-android',
      name: 'Android 客户端',
      canonicalPath: 'C:\\Projects\\agentdeck\\android',
      enabled: true,
    },
  ],
  devices: [
    {
      deviceId: 'fixture-pad',
      displayName: '小米平板 7',
      createdAt: '2026-10-20T03:30:00Z',
      connected: true,
    },
  ],
  addresses: ['127.0.0.1', '192.168.1.20'],
  approvals: [] as Record<string, unknown>[],
};
const approval = {
  approvalId: 'fixture-approval',
  sessionId: 'fixture-session',
  turnId: 'fixture-turn',
  sessionTitle: '修复登录页面的布局',
  method: 'item/commandExecution/requestApproval',
  status: 'pending',
  expiresAt,
  allowedDecisions: ['approve', 'reject'],
  context: {
    command: 'Write-Output AGENTDECK_UI_FIXTURE',
    cwd: 'C:\\Projects\\website',
    reason: '隔离界面测试：此命令不会实际执行。',
    permissions: { network: false },
  },
};
desktop.send('state', fixture);
console.log(
  'Isolated desktop preview. stdin: approval / clear / expired / error / stop. No actions execute.',
);
desktop.on('action', (action) => {
  console.log('PREVIEW_ACTION', action.action);
  if (action.action === 'stop') desktop.close();
  else desktop.send('error', { message: '这是隔离界面预览，不执行项目授权、配对或审批。' });
});
desktop.on('closed', () => process.exit(0));
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line === 'stop') desktop.close();
  else if (line === 'error')
    desktop.send('error', { message: '连接暂不可用：这是用于检查提示条的隔离测试信息。' });
  else {
    fixture.approvals =
      line === 'approval'
        ? [approval]
        : line === 'expired'
          ? [{ ...approval, expiresAt: '2020-01-01T00:00:00Z' }]
          : [];
    desktop.send('state', fixture);
  }
});
