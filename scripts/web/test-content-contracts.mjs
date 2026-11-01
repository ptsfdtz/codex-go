import assert from 'node:assert/strict';
import { TextEncoder } from 'node:util';
import { test } from 'node:test';
import { loadWebModule } from './load-web-module.mjs';
const { contentText, fileReferencePart } = await loadWebModule('content-text');
const { turnOptions } = await loadWebModule('features/composer-options');
const { appendQuote } = await loadWebModule('features/selection-quote');

test('history text keeps nested content and hides native structured file references', () => {
  const text = 'C:/project/中文 file.txt';
  const reference = {
    type: 'text',
    text,
    text_elements: [
      {
        byteRange: { start: 0, end: new TextEncoder().encode(text).length },
        placeholder: '@中文 file.txt',
      },
    ],
  };
  assert.deepEqual(fileReferencePart(reference), { name: '中文 file.txt', path: text });
  assert.equal(contentText([{ text: 'hello' }, reference, { output: ['world'] }]), 'hello\nworld');
  assert.equal(
    fileReferencePart({
      ...reference,
      text_elements: [{ byteRange: { start: 0, end: text.length }, placeholder: '@中文 file.txt' }],
    }),
    undefined,
  );
});
test('lazy composer extraction preserves the complete wire options', () => {
  const draft = {
    text: ' hello ',
    mode: 'plan',
    model: 'model-a',
    effort: 'high',
    attachments: [{ name: 'a.txt', data: 'AA==', bytes: 1 }],
    references: [{ projectId: 'p', path: '中文.txt' }],
    skills: [{ id: 'skill' }],
  };
  assert.deepEqual(turnOptions(draft, 'workspace'), {
    text: 'hello',
    mode: 'plan',
    permissionMode: 'workspace',
    model: 'model-a',
    effort: 'high',
    attachments: [{ name: 'a.txt', data: 'AA==' }],
    references: [{ projectId: 'p', path: '中文.txt' }],
    skills: ['skill'],
  });
});
test('lazy selection controls preserve quote formatting and draft content', () => {
  assert.equal(appendQuote('draft', ' one\r\ntwo '), 'draft\n\n> one\n> two\n\n');
});
