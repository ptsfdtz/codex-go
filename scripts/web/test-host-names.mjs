import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(
  new URL('../../web/src/features/host-names.ts', import.meta.url),
  'utf8',
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { hostName, migrateHostNames } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);
const host = {
  hostId: 'pc',
  displayName: 'DESKTOP-TEST',
  online: false,
  customName: null,
  customNameConfigured: false,
};
const key = 'agentdeck.web.label.account:device.pc';
function storage(value) {
  const map = new Map([[key, value]]);
  return { getItem: (k) => map.get(k) ?? null, removeItem: (k) => map.delete(k) };
}
test('configured names replace the machine name; cleared names use the default', () => {
  assert.equal(hostName({ ...host, customName: '笔记本电脑' }), '笔记本电脑');
  assert.equal(hostName(host), 'DESKTOP-TEST');
});
test('legacy name is uploaded once and removed only after confirmed save', async () => {
  const local = storage(' 学校服务器 ');
  const names = await migrateHostNames(
    [host],
    'account:device',
    local,
    async (id, name) => {
      assert.equal(id, 'pc');
      assert.equal(name, '学校服务器');
      assert.equal(local.getItem(key), ' 学校服务器 ');
      return { hostId: id, customName: name, customNameConfigured: true };
    },
    () => true,
  );
  assert.equal(names[0].customName, '学校服务器');
  assert.equal(local.getItem(key), null);
});
test('failed upload preserves the local name for retry', async () => {
  const local = storage('笔记本');
  await assert.rejects(
    migrateHostNames(
      [host],
      'account:device',
      local,
      async () => {
        throw Error('offline');
      },
      () => true,
    ),
  );
  assert.equal(local.getItem(key), '笔记本');
});
test('server rename or explicit clear cannot be overwritten by stale browser migration', async () => {
  for (const name of ['服务器名称', null]) {
    const local = storage('旧名称');
    const result = await migrateHostNames(
      [{ ...host, customName: name, customNameConfigured: true }],
      'account:device',
      local,
      async () => {
        throw Error('unexpected write');
      },
      () => true,
    );
    assert.equal(result[0].customName, name);
    assert.equal(local.getItem(key), null);
  }
});
test('concurrent server change wins and account switches retain the old local name', async () => {
  const local = storage('旧名称');
  const result = await migrateHostNames(
    [host],
    'account:device',
    local,
    async () => ({ hostId: 'pc', customName: '另一设备', customNameConfigured: true }),
    () => true,
  );
  assert.equal(result[0].customName, '另一设备');
  const switched = storage('保留');
  let active = true;
  await migrateHostNames(
    [host],
    'account:device',
    switched,
    async () => {
      active = false;
      return { hostId: 'pc', customName: '保留' };
    },
    () => active,
  );
  assert.equal(switched.getItem(key), '保留');
});
test('other accounts, invalid names and old servers do not trigger migration', async () => {
  for (const value of ['x'.repeat(81), 'bad\nname', '   ']) {
    await migrateHostNames(
      [host],
      'account:device',
      storage(value),
      async () => {
        throw Error('unexpected write');
      },
      () => true,
    );
  }
  await migrateHostNames(
    [host],
    'other:device',
    storage('笔记本'),
    async () => {
      throw Error('cross-account write');
    },
    () => true,
  );
  await migrateHostNames(
    [{ ...host, customNameConfigured: undefined }],
    'account:device',
    storage('笔记本'),
    async () => {
      throw Error('old server');
    },
    () => true,
  );
});
