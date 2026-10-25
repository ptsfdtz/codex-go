/* global fetch, AbortSignal */
// Private local operator side of browser-live.mjs. Never exposes management
// credentials or approves a request without matching the browser's six digits.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const directory = resolve(process.argv[2]);
const action = process.argv[3];
const endpoint = JSON.parse(readFileSync(join(directory, 'management.json'), 'utf8'));
assert.match(endpoint.address, /^127\.0\.0\.1:\d+$/);
async function control(payload) {
  const response = await fetch(`http://${endpoint.address}/control`, {
    method: 'POST',
    headers: { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(95000),
  });
  const result = await response.json();
  assert.ok(response.ok && result.ok === true, `Control failed: ${result.code}`);
  return result.result;
}
if (action === 'invite') {
  const file = join(directory, 'browser-fixture.json');
  const fixture = JSON.parse(readFileSync(file, 'utf8'));
  fixture.invitation = await control({ action: 'pair.invite', address: '127.0.0.1', version: 3 });
  writeFileSync(file, JSON.stringify(fixture), { mode: 0o600 });
  console.log('Invitation refreshed in private fixture file');
} else if (action === 'approve') {
  const code = process.argv[4];
  assert.match(code, /^\d{6}$/);
  const state = await control({ action: 'state' });
  const pending = state.pairings.filter(
    (item) => item.code === code && item.displayName === 'AgentDeck Web',
  );
  assert.equal(pending.length, 1, 'Browser code must uniquely match a pending request');
  await control({ action: 'pair.approve', requestId: pending[0].requestId, code });
  console.log('Browser and host six-digit codes matched; approved');
} else if (action === 'cleanup') {
  const state = await control({ action: 'state' });
  for (const device of state.devices.filter((item) => item.displayName === 'AgentDeck Web'))
    await control({ action: 'device.revoke', deviceId: device.deviceId });
  console.log('Only this isolated fixture browser grants cleaned up');
} else if (action === 'revoke') {
  const id = process.argv[4];
  assert.match(id || '', /^[a-f0-9-]{36}$/);
  const state = await control({ action: 'state' });
  const device = state.devices.filter((item) => item.deviceId === id);
  assert.equal(device.length, 1, 'Revoke only the unique browser acceptance device');
  await control({ action: 'device.revoke', deviceId: device[0].deviceId });
  console.log('Acceptance browser device revoked');
} else if (action === 'stop') {
  await control({ action: 'stop' });
  console.log('Browser fixture stopped');
} else throw new Error('Unsupported browser acceptance control action');
