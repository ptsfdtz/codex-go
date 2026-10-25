/* global fetch, AbortSignal */
// Explicit live acceptance only. Uses a separately authorized workspace and
// private state directory; never opens or edits a Codex private database.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { connect } from 'node:tls';
import https from 'node:https';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const directory = resolve(process.argv[2]);
const workspace = resolve(process.argv[3]);
const mode = process.argv[4] || 'initial';
const commandMarker = 'AGENTDECK_COMMAND_' + randomUUID();
const commandFile = 'agentdeck-command-' + randomUUID() + '.txt';
const recoveryFile = join(directory, 'acceptance-recovery.json');
const reportFile = join(directory, 'acceptance-result.json');
const token = () => randomBytes(32).toString('base64url');
async function control(action) {
  const endpoint = JSON.parse(readFileSync(join(directory, 'management.json'), 'utf8'));
  assert.match(endpoint.address, /^127\.0\.0\.1:\d+$/);
  const response = await fetch(`http://${endpoint.address}/control`, {
    method: 'POST',
    headers: { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(action),
    signal: AbortSignal.timeout(95000),
  });
  const value = await response.json();
  if (!response.ok || value.ok !== true) throw new Error(`Management failed: ${value.code}`);
  return value.result;
}
async function pinnedCertificate(invitation) {
  const endpoint = new URL(invitation.endpoint);
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: endpoint.hostname,
      port: Number(endpoint.port),
      rejectUnauthorized: false,
    });
    socket.setTimeout(10000, () => socket.destroy(new Error('Certificate probe timeout')));
    socket.on('error', reject);
    socket.on('secureConnect', () => {
      // No application request or credential is sent until this check passes.
      const raw = socket.getPeerCertificate().raw;
      if (createHash('sha256').update(raw).digest('hex') !== invitation.fingerprint) {
        socket.destroy();
        reject(new Error('Certificate fingerprint mismatch'));
        return;
      }
      socket.end();
      resolve(`-----BEGIN CERTIFICATE-----\n${raw.toString('base64')}\n-----END CERTIFICATE-----`);
    });
  });
}
async function post(endpoint, ca, path, payload) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload));
    const request = https.request(
      endpoint + path,
      {
        method: 'POST',
        ca,
        headers: { 'content-type': 'application/json', 'content-length': body.length },
      },
      (response) => {
        const chunks = [];
        response.on('data', (bytes) => chunks.push(bytes));
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new Error(`Pair HTTP ${response.statusCode}`));
            return;
          }
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        });
      },
    );
    request.on('error', reject);
    request.setTimeout(15000, () => request.destroy(new Error('Pair timeout')));
    request.end(body);
  });
}
async function open(saved) {
  const socket = new WebSocket(saved.endpoint.replace('https:', 'wss:') + '/api/v1/ws', {
    ca: saved.ca,
    headers: { authorization: `Bearer ${saved.credential}` },
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const pending = new Map();
  let progress = 0;
  let outputStarted = false;
  socket.on('message', (bytes) => {
    const packet = JSON.parse(bytes);
    if (packet.type === 'event' && packet.action === 'turn.progress') progress++;
    if (packet.payload?.method === 'item/agentMessage/delta') outputStarted = true;
    const request = pending.get(packet.id);
    if (request) {
      pending.delete(packet.id);
      clearTimeout(request.timer);
      if (packet.type === 'error') request.reject(new Error(`RPC ${packet.code}`));
      else request.resolve(packet.payload);
    }
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Native connection closed'));
    }
    pending.clear();
  });
  return {
    socket,
    progress: () => progress,
    outputStarted: () => outputStarted,
    request: (action, payload = {}) =>
      new Promise((resolve, reject) => {
        const id = 'linux-acceptance-' + randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`RPC timeout ${action}; inspect unknown result before retrying`));
        }, 30000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ v: 1, type: 'request', id, action, payload }));
      }),
  };
}
if (mode === 'unknown') {
  const saved = JSON.parse(readFileSync(recoveryFile, 'utf8'));
  let client = await open(saved);
  await client.request('system.hello', { client: 'AgentDeck Linux acceptance', version: 1 });
  const id = 'linux-unknown-' + randomUUID(),
    title = 'Unknown receipt ' + randomUUID();
  writeFileSync(
    join(directory, 'acceptance-pending.json'),
    JSON.stringify({ hostId: saved.hostId, requestId: id, action: 'sessions.create' }),
    { mode: 0o600 },
  );
  // Deliberately drop the response path after handing the one mutation to TLS.
  // No second sessions.create is issued, regardless of the status result.
  await new Promise((resolve, reject) =>
    client.socket.send(
      JSON.stringify({
        v: 1,
        type: 'request',
        id,
        action: 'sessions.create',
        payload: { projectId: saved.projectId, title },
      }),
      (error) => (error ? reject(error) : resolve()),
    ),
  );
  client.socket.terminate();
  client = await open(saved);
  try {
    await client.request('system.hello', { client: 'AgentDeck Linux acceptance', version: 1 });
    let status;
    const until = Date.now() + 15000;
    do {
      status = await client.request('requests.status', { requestId: id });
      if (status.status === 'done') break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    } while (Date.now() < until);
    assert.equal(status.status, 'done', 'Unknown/notFound must remain unresolved; never resend');
    assert.equal(status.response.id, id);
    assert.equal(status.response.type, 'response');
    const snapshot = await client.request('snapshot.get');
    assert.equal(snapshot.sessions.filter((item) => item.title === title).length, 1);
    const report = {
      at: new Date().toISOString(),
      unknownResponseDropped: true,
      receiptConfirmed: true,
      mutationCount: 1,
      automaticResends: 0,
    };
    writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 });
    writeFileSync(
      join(directory, 'acceptance-pending.json'),
      JSON.stringify({ hostId: saved.hostId, requestId: id, status: 'done' }),
      { mode: 0o600 },
    );
    console.log(JSON.stringify(report));
  } finally {
    client.socket.close();
  }
  process.exit(0);
}
if (['inspect', 'interrupt', 'recovery'].includes(mode)) {
  const saved = JSON.parse(readFileSync(recoveryFile, 'utf8'));
  const client = await open(saved);
  try {
    const hello = await client.request('system.hello', {
      client: 'AgentDeck Linux acceptance',
      version: 1,
    });
    assert.equal(hello.hostId, saved.hostId);
    const snapshot = await client.request('sessions.detail', {
      sessionId: saved.sessionId,
      limit: 10,
    });
    if (mode === 'interrupt') {
      const turn = snapshot.turns.find(
        (turn) =>
          turn.sessionId === saved.sessionId &&
          ['queued', 'running', 'waitingApproval'].includes(turn.status),
      );
      assert.ok(turn, 'no running acceptance turn');
      await client.request('turn.interrupt', { sessionId: saved.sessionId, turnId: turn.turnId });
      console.log('Acceptance turn interruption acknowledged');
      process.exitCode = 0;
    } else if (mode === 'recovery') {
      assert.equal(snapshot.session.sessionId, saved.sessionId);
      const history = await client.request('sessions.history', {
        sessionId: saved.sessionId,
        limit: 50,
        sortDirection: 'desc',
      });
      assert.ok(history.data.length);
      console.log(
        JSON.stringify({
          sameHost: true,
          sameSession: true,
          grantRestored: true,
          persistedHistoryItems: history.data.length,
        }),
      );
    } else {
      const history = await client.request('sessions.history', {
        sessionId: saved.sessionId,
        limit: 50,
        sortDirection: 'desc',
      });
      console.log(
        JSON.stringify({
          turns: snapshot.turns.filter((turn) => turn.sessionId === saved.sessionId),
          approvals: (await client.request('snapshot.get')).approvals.filter(
            (item) => item.sessionId === saved.sessionId,
          ),
          history,
        }),
      );
    }
  } finally {
    client.socket.close();
  }
  process.exit(0);
}
let saved, client;
try {
  const state = await control({ action: 'state' });
  assert.equal(state.codexReady, true);
  assert.equal(state.sandboxVerified, true);
  if (mode === 'initial') {
    await control({ action: 'project.add', path: workspace });
    const state = await control({ action: 'state' }),
      project = state.projects.find((item) => item.canonicalPath === workspace);
    assert.ok(project, 'authorized test project missing');
    const invitation = await control({ action: 'pair.invite', address: '127.0.0.1', version: 2 });
    const ca = await pinnedCertificate(invitation);
    const pending = await post(invitation.endpoint, ca, '/api/v1/pair/request', {
      token: invitation.token,
      displayName: 'Linux live acceptance',
      nonce: token(),
    });
    assert.match(pending.code, /^\d{6}$/);
    await control({ action: 'pair.approve', requestId: pending.requestId, code: pending.code });
    const grant = await post(invitation.endpoint, ca, '/api/v1/pair/claim', {
      requestId: pending.requestId,
      claimToken: pending.claimToken,
    });
    assert.equal(grant.status, 'approved');
    assert.equal(grant.hostId, invitation.hostId);
    saved = {
      endpoint: invitation.endpoint,
      ca,
      hostId: grant.hostId,
      credential: grant.credential,
      projectId: project.projectId,
    };
    client = await open(saved);
    const hello = await client.request('system.hello', {
      client: 'AgentDeck Linux acceptance',
      version: 1,
    });
    assert.equal(hello.hostId, saved.hostId);
    const created = await client.request('sessions.create', {
      projectId: project.projectId,
      title: 'AgentDeck Linux live acceptance',
    });
    saved.sessionId = created.session.sessionId;
    writeFileSync(recoveryFile, JSON.stringify(saved), { mode: 0o600 });
  } else {
    saved = JSON.parse(readFileSync(recoveryFile, 'utf8'));
    client = await open(saved);
    const hello = await client.request('system.hello', {
      client: 'AgentDeck Linux acceptance',
      version: 1,
    });
    assert.equal(hello.hostId, saved.hostId);
    const snapshot = await client.request('snapshot.get');
    assert.ok(snapshot.sessions.some((item) => item.sessionId === saved.sessionId));
  }
  const marker =
    mode === 'command'
      ? commandMarker
      : mode === 'questions'
        ? 'AGENTDECK_QUESTION_OK'
        : mode === 'approval'
          ? 'AGENTDECK_APPROVAL_REJECTED'
          : mode === 'initial'
            ? 'AGENTDECK_LINUX_FIRST_OK'
            : 'AGENTDECK_LINUX_RESUME_OK';
  const text =
    mode === 'command'
      ? `Run exactly this shell command in the authorized workspace using the default sandbox, without requesting escalation: printf '%s\\n' '${commandMarker}' > '${commandFile}'. Do not use file-edit tools or any alternative. Then reply exactly ${marker}. If the sandbox fails, stop; do not retry outside it.`
      : mode === 'questions'
        ? `Use request_user_input to ask one question with id acceptance_choice and options Alpha and Beta. Do not use other tools. Wait for my answer, then reply exactly ${marker} and my chosen option.`
        : mode === 'approval'
          ? `For an approval rejection test, request sandbox escalation to run exactly: cat /var/lib/agentdeck-acceptance/approval-marker.txt. This file is outside the authorized workspace. Ask for approval before running. If denied, do not retry or run any alternative command; reply exactly ${marker}.`
          : mode === 'interrupt-test'
            ? 'Write a numbered list of 2000 distinct short English sentences, one per line. Continue until all 2000 lines are written. Do not use any tools or change files.'
            : `Reply exactly ${marker}. Do not use tools, run commands, or change files.`;
  const result = await client.request('turn.start', {
    sessionId: saved.sessionId,
    text,
    ...(mode === 'questions' ? { mode: 'plan' } : {}),
  });
  const until = Date.now() + 180000;
  let status;
  let decisionConfirmed = false;
  do {
    const snapshot = await client.request('sessions.detail', {
      sessionId: saved.sessionId,
      limit: 10,
    });
    status = snapshot.turns.find((item) => item.turnId === result.turn.turnId)?.status;
    if (mode === 'command' && status === 'waitingApproval') {
      const state = await client.request('snapshot.get');
      const approval = state.approvals.find(
        (item) => item.sessionId === saved.sessionId && item.turnId === result.turn.turnId,
      );
      assert.ok(approval, 'active approval must have a routed record');
      await client.request('approvals.decide', {
        sessionId: saved.sessionId,
        turnId: result.turn.turnId,
        approvalId: approval.approvalId,
        decision: 'reject',
      });
      throw new Error(
        'Sandboxed command requested approval; rejected rather than bypassing isolation',
      );
    }
    if (
      ['questions', 'approval'].includes(mode) &&
      status === 'waitingApproval' &&
      !decisionConfirmed
    ) {
      const state = await client.request('snapshot.get');
      const approval = state.approvals.find(
        (item) => item.sessionId === saved.sessionId && item.turnId === result.turn.turnId,
      );
      assert.ok(approval, 'active approval must have a routed record');
      if (mode === 'questions') assert.equal(approval.method, 'item/tool/requestUserInput');
      else assert.notEqual(approval.method, 'item/tool/requestUserInput');
      const answers = Object.fromEntries(
        (approval.context.questions || []).map((question) => [question.id, { answers: ['Alpha'] }]),
      );
      await client.request('approvals.decide', {
        sessionId: saved.sessionId,
        turnId: result.turn.turnId,
        approvalId: approval.approvalId,
        decision: mode === 'questions' ? 'approve' : 'reject',
        ...(mode === 'questions' ? { answers } : {}),
      });
      decisionConfirmed = true;
    }
    if (mode === 'interrupt-test' && client.outputStarted() && !decisionConfirmed) {
      await client.request('turn.interrupt', {
        sessionId: saved.sessionId,
        turnId: result.turn.turnId,
      });
      decisionConfirmed = true;
    }
    if (['completed', 'failed', 'interrupted'].includes(status)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < until);
  const expected =
    mode === 'approval'
      ? ['completed', 'interrupted']
      : [mode === 'interrupt-test' ? 'interrupted' : 'completed'];
  assert.ok(
    expected.includes(status),
    'real model turn must reach the expected authoritative terminal state',
  );
  if (['questions', 'approval', 'interrupt-test'].includes(mode))
    assert.ok(decisionConfirmed, 'real question/approval/interruption must be exercised');
  const history = await client.request('sessions.history', {
    sessionId: saved.sessionId,
    limit: 50,
    sortDirection: 'desc',
  });
  if (mode !== 'interrupt-test' && status === 'completed')
    assert.ok(
      history.data.some(
        (entry) => entry.item?.type === 'agentMessage' && entry.item.text?.includes(marker),
      ),
      'marker must be in the model answer, not just the user prompt',
    );
  if (mode === 'command') {
    assert.ok(
      existsSync(join(workspace, commandFile)),
      'sandboxed command did not create its output file; a model answer alone is insufficient',
    );
    assert.equal(readFileSync(join(workspace, commandFile), 'utf8').trim(), commandMarker);
    assert.ok(
      history.data.some(
        (entry) =>
          entry.turnId === result.turn.upstreamTurnId &&
          entry.item?.type === 'commandExecution' &&
          entry.item.exitCode === 0,
      ),
      'native history must confirm successful command execution',
    );
  }
  const report = {
    at: new Date().toISOString(),
    platform: process.platform,
    mode,
    realCodexVersion: '0.163.0-alpha.10.2',
    paired: true,
    authoritativeStatus: status,
    historyConfirmed: true,
    streamingEvents: client.progress(),
    sameHostAndSessionAfterRestart: mode === 'resume',
    ...(decisionConfirmed ? { realDecisionConfirmed: true } : {}),
    ...(mode === 'command' ? { sandboxedCommandVerified: true } : {}),
  };
  writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
} finally {
  client?.socket.close();
}
