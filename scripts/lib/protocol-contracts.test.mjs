import assert from 'node:assert/strict';
import test from 'node:test';
import { compareContracts, methodContracts } from './protocol-contracts.mjs';

const schema = () => ({
  definitions: {
    Params: { properties: { nested: { $ref: '#/definitions/Nested' } } },
    Nested: {
      type: 'object',
      properties: { parent: { $ref: '#/definitions/Params' } },
      required: [],
    },
  },
  oneOf: [
    { properties: { method: { const: 'thread/read' }, params: { $ref: '#/definitions/Params' } } },
  ],
});

test('transitive cyclic params drift is detected even when the method branch stays identical', () => {
  const before = schema();
  const after = schema();
  after.definitions.Nested.required.push('parent');
  const diff = compareContracts(methodContracts(before), methodContracts(after));
  assert.deepEqual(
    diff.changed.map((item) => item.name),
    ['thread/read'],
  );
  assert.equal(diff.changed[0].differences[0].path, '/references/#~1definitions~1Nested/required');
});

test('key ordering and unused definitions do not create method drift', () => {
  const before = schema();
  const after = schema();
  after.definitions.Nested = {
    required: [],
    properties: after.definitions.Nested.properties,
    type: 'object',
  };
  after.definitions.Unused = { type: 'number' };
  assert.deepEqual(compareContracts(methodContracts(before), methodContracts(after)).unchanged, [
    'thread/read',
  ]);
});

test('added and removed methods remain explicit and invalid references fail closed', () => {
  const before = methodContracts(schema());
  assert.deepEqual(compareContracts(before, {}).removed, ['thread/read']);
  assert.deepEqual(compareContracts({}, before).added, ['thread/read']);
  const broken = schema();
  delete broken.definitions.Nested;
  assert.throws(() => methodContracts(broken), /Missing schema reference/);
  broken.definitions.Nested = { $ref: 'other.json' };
  assert.throws(() => methodContracts(broken), /Unsupported schema reference/);
});

test('large changed schema values retain reproducible evidence without unbounded report copies', () => {
  const before = methodContracts(schema());
  const changed = schema();
  changed.definitions.Nested.description = 'x'.repeat(4096);
  const diff = compareContracts(before, methodContracts(changed));
  const value = diff.changed[0].differences[0].after;
  assert.equal(value.evidence, 'sha256-only');
  assert.match(value.sha256, /^[a-f0-9]{64}$/);
  assert.equal(value.jsonBytes, 4098);
});
