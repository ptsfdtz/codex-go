import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beforeEach, test } from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../../web/src/features/composer-preferences.ts', import.meta.url),
  'utf8',
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const {
  readComposerPreferences,
  saveComposerPreferences,
  readComposerModelPreferences: readModel,
  saveComposerModelPreferences: saveModel,
} = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

let storage;
beforeEach(() => {
  storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
});

const key = (session, host = 'host', account = 'account') =>
  JSON.stringify([account, host, session]);

test('switching A → B → A preserves each model and effort, including after reload', () => {
  const a = { model: 'model-a', effort: 'high' };
  const b = { model: 'model-b', effort: 'low' };
  saveModel(key('a'), a);
  saveModel(key('b'), b);
  assert.deepEqual(readModel(key('a')), a);
  assert.deepEqual(readModel(key('b')), b);
  saveModel(key('b'), { model: 'model-c', effort: '' });
  assert.deepEqual(readModel(key('a')), a);
  assert.deepEqual(readModel(key('b')), { model: 'model-c', effort: '' });
});

test('existing conversations start with their own Host model instead of the old computer-wide choice', () => {
  saveComposerPreferences(JSON.stringify(['account', 'host']), {
    model: 'old-shared-model',
    effort: 'high',
    permission: 'full',
  });
  assert.deepEqual(readModel(key('a'), { model: 'host-model-a', effort: 'low' }), {
    model: 'host-model-a',
    effort: 'low',
  });
  assert.deepEqual(readModel(key('b'), { model: 'host-model-b', effort: 'high' }), {
    model: 'host-model-b',
    effort: 'high',
  });
  assert.deepEqual(readModel(key('new:project')), { model: '', effort: '' });
});

test('new drafts, conversations, computers and accounts have independent model storage', () => {
  saveModel(key('a'), { model: 'model-a', effort: 'high' });
  for (const other of [
    key('b'),
    key('new:project'),
    key('a', 'other-host'),
    key('a', 'host', 'other-account'),
  ])
    assert.deepEqual(readModel(other), { model: '', effort: '' });
});

test('explicit default choices survive reload instead of falling back to the previous Host model', () => {
  saveModel(key('a'), { model: '', effort: '' });
  assert.deepEqual(readModel(key('a'), { model: 'old-model', effort: 'high' }), {
    model: '',
    effort: '',
  });
});

test('changing models leaves computer permission memory intact', () => {
  const hostKey = JSON.stringify(['account', 'host']);
  saveComposerPreferences(hostKey, { model: '', effort: '', permission: 'full' });
  saveModel(key('a'), { model: 'model-a', effort: 'high' });
  assert.equal(readComposerPreferences(hostKey).permission, 'full');
});

test('invalid and inaccessible storage fall back to the current conversation metadata', () => {
  const fallback = { model: 'host-model', effort: 'low' };
  for (const value of ['{', 'null', '{"model":42,"effort":"high"}', '{"model":"other"}']) {
    storage.set(`agentdeck.web.composer.model.${key('a')}`, value);
    assert.deepEqual(readModel(key('a'), fallback), fallback);
  }
  globalThis.localStorage = {
    getItem() {
      throw new Error('unavailable');
    },
    setItem() {
      throw new Error('unavailable');
    },
  };
  assert.deepEqual(readModel(key('a'), fallback), fallback);
  assert.doesNotThrow(() => saveModel(key('a'), fallback));
});
