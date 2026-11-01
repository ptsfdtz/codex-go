import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadWebModule as load } from './load-web-module.mjs';

const { isSessionWorking } = await load('workspace');
const { changesDirectory } = await load('transport/resume');

test('native queue continuation stays visible across local terminal and unknown states', () => {
  for (const status of ['unknown', 'completed', 'idle']) {
    const session = { sessionId: 'queued-conversation', status };
    assert.equal(isSessionWorking(session), false);
    assert.equal(
      isSessionWorking({ ...session, upstream: { status: { type: 'active', activeFlags: [] } } }),
      true,
    );
    for (const type of ['idle', 'notLoaded', 'systemError'])
      assert.equal(isSessionWorking({ ...session, upstream: { status: { type } } }), false);
  }
});

test('managed work remains visible and a waiting queue alone does not spin', () => {
  for (const status of ['running', 'inProgress'])
    assert.equal(isSessionWorking({ sessionId: 'managed', status }), true);
  for (const status of ['queued', 'waitingApproval', 'unknown', 'failed', 'interrupted', undefined])
    assert.equal(isSessionWorking({ sessionId: 'managed', status }), false);
});

test('managed and native starts refresh the directory without refreshing on streaming output', () => {
  for (const action of ['turn.progress', 'upstream.progress']) {
    assert.equal(changesDirectory({ action, payload: { method: 'turn/started' } }), true);
    for (const method of ['item/started', 'item/agentMessage/delta', 'item/completed'])
      assert.equal(changesDirectory({ action, payload: { method } }), false);
  }
  for (const action of ['sessions.synced', 'upstream.turn.completed', 'turn.completed'])
    assert.equal(changesDirectory({ action }), true);
  assert.equal(changesDirectory({ action: 'queue.changed' }), false);
});
