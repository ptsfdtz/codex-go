import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectGuiHistory } from './gui-history.mjs';

const seed = { threadId: 'thread-a', turnId: 'turn-a', input: 'input', answer: 'answer' };
const items = [
  { type: 'userMessage', content: [{ type: 'text', text: seed.input }] },
  { type: 'agentMessage', text: seed.answer },
];
const both = { user: true, assistant: true };
const neither = { user: false, assistant: false };
const turn = { id: seed.turnId, items };
const thread = { id: seed.threadId, turns: [turn] };

test('read and resume require both request and response identity', () => {
  for (const method of ['thread/read', 'thread/resume']) {
    const request = { method, threadId: seed.threadId };
    assert.deepEqual(inspectGuiHistory(request, { thread }, seed), both);
    assert.deepEqual(
      inspectGuiHistory({ ...request, threadId: 'other' }, { thread }, seed),
      neither,
    );
    assert.deepEqual(
      inspectGuiHistory(request, { thread: { ...thread, id: 'other' } }, seed),
      neither,
    );
    assert.deepEqual(
      inspectGuiHistory(
        request,
        { thread: { ...thread, turns: [{ ...turn, id: 'other' }] } },
        seed,
      ),
      neither,
    );
  }
});

test('turn and item pages only credit the seeded turn', () => {
  const request = { method: 'thread/turns/list', threadId: seed.threadId };
  assert.deepEqual(inspectGuiHistory(request, { data: [turn] }, seed), both);
  assert.deepEqual(inspectGuiHistory(request, { data: [{ ...turn, id: 'other' }] }, seed), neither);
  const itemRequest = { ...request, method: 'thread/items/list' };
  const data = items.map((item) => ({ turnId: seed.turnId, item }));
  assert.deepEqual(inspectGuiHistory(itemRequest, { data }, seed), both);
  assert.deepEqual(
    inspectGuiHistory(itemRequest, { data: data.map((v) => ({ ...v, turnId: 'other' })) }, seed),
    neither,
  );
});

test('metadata, missing seed and partial or wrong content do not prove exact history', () => {
  const request = { method: 'thread/read', threadId: seed.threadId };
  assert.deepEqual(inspectGuiHistory(request, { thread }, { ...seed, turnId: undefined }), neither);
  assert.deepEqual(
    inspectGuiHistory({ ...request, method: 'thread/list' }, { thread }, seed),
    neither,
  );
  assert.deepEqual(inspectGuiHistory(request, { thread: { id: seed.threadId } }, seed), neither);
  assert.deepEqual(
    inspectGuiHistory(request, { thread }, { ...seed, input: 'in', answer: 'ans' }),
    neither,
  );
  assert.deepEqual(inspectGuiHistory(request, { thread }, { ...seed, answer: 'wrong' }), {
    user: true,
    assistant: false,
  });
});
