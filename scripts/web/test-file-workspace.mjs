import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const requireWeb = createRequire(new URL('../../web/package.json', import.meta.url));
async function load(name) {
  const source = await readFile(
    new URL(`../../web/src/features/files/${name}.ts`, import.meta.url),
    'utf8',
  );
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  outputText = outputText.replace(
    /from '(highlight\.js[^']*)'/g,
    (_, name) => `from '${pathToFileURL(requireWeb.resolve(name)).href}'`,
  );
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { openTab, closeTab, restoreWorkspace, validFilePath, parentPaths, diffLines, MAX_TABS } =
  await load('workspace-state');
const { highlightLines } = await load('highlight');

test('file and diff views share a tab; closing the active tab selects its neighbor', () => {
  let state = { tabs: [], active: '' };
  state = openTab(state, { path: 'src/a.ts', view: 'file' });
  state = openTab(state, { path: 'src/b.ts', view: 'file' });
  state = openTab(state, { path: 'src/a.ts', view: 'diff' });
  assert.equal(state.tabs.length, 2);
  assert.equal(state.tabs[0].view, 'diff');
  assert.equal(closeTab(state, 'src/a.ts').active, 'src/b.ts');
  assert.equal(closeTab(closeTab(state, 'src/a.ts'), 'src/b.ts').tabs.length, 0);
});
test('bounded tab retention keeps the current file when opening another file', () => {
  let state = { tabs: [], active: '' };
  for (let i = 0; i < MAX_TABS; i++) state = openTab(state, { path: `${i}.ts`, view: 'file' });
  state = openTab(state, { path: '0.ts', view: 'file' });
  state = openTab(state, { path: 'another.ts', view: 'file' });
  assert.equal(state.tabs.length, MAX_TABS);
  assert(state.tabs.some((tab) => tab.path === '0.ts'));
});
test('restored tabs reject traversal, invalid views and duplicates', () => {
  const state = restoreWorkspace(
    JSON.stringify({
      active: '/etc/passwd',
      tabs: [
        { path: '../secret', view: 'file' },
        { path: '/etc/passwd', view: 'file' },
        { path: 'src/a.ts', view: 'file' },
        { path: 'src/a.ts', view: 'diff' },
        { path: 'src/b.ts', view: 'write' },
        { path: '', view: 'changes' },
      ],
    }),
  );
  assert.deepEqual(state, {
    tabs: [
      { path: 'src/a.ts', view: 'file' },
      { path: '', view: 'changes' },
    ],
    active: 'src/a.ts',
  });
  assert.deepEqual(restoreWorkspace('{'), { tabs: [], active: '' });
});
test('relative paths support unicode and dotfiles while rejecting unsafe input', () => {
  for (const path of ['src/中文.ts', '.github/workflows/ci.yml', '__proto__/constructor.txt'])
    assert(validFilePath(path));
  for (const path of ['', '../a', '/a', 'a//b', './a', 'a/../b', 'C:/a', 'a\\b', 'a\0b'])
    assert(!validFilePath(path));
  assert.deepEqual(parentPaths('src/features/Composer.tsx'), ['src', 'src/features']);
});
test('diff gutters track old and new line numbers across hunks and literal header-like code', () => {
  const rows = diffLines(
    'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -10,2 +20,2 @@\n keep\n--- removed code\n+++ added code\n@@ -30 +40 @@\n-old\n+new',
  );
  assert.deepEqual(rows[4], { text: ' keep', kind: 'context', old: 10, next: 20 });
  assert.deepEqual(rows[5], { text: '--- removed code', kind: 'remove', old: 11 });
  assert.deepEqual(rows[6], { text: '+++ added code', kind: 'add', next: 21 });
  assert.equal(rows[9].next, 40);
  assert.equal(diffLines('new\nfile', true)[1].next, 2);
});
test('syntax highlighting balances multiline spans and escapes HTML', () => {
  const result = highlightLines(
    '/* first\nsecond */\nconst text = "<script>alert(1)</script>";',
    'src/a.ts',
  );
  assert.equal(result.lines.length, 3);
  for (const line of result.lines)
    assert.equal((line.match(/<span\b/g) || []).length, (line.match(/<\/span>/g) || []).length);
  assert(result.lines[0].includes('hljs-comment'));
  assert(!result.lines.join('').includes('<script>'));
  assert(result.lines[2].includes('&lt;script&gt;'));
});
test('large files retain every line and skip expensive highlighting', () => {
  const source = Array.from({ length: 20000 }, (_, i) => `const row${i} = ${i};`).join('\n');
  const result = highlightLines(source, 'large.ts');
  assert.equal(result.lines.length, 20000);
  assert.equal(result.lines.at(-1), 'const row19999 = 19999;');
});
