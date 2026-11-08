import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { loadWebModule } from './load-web-module.mjs';
import ts from 'typescript';
const { t, setLanguagePreference, errorText } = await loadWebModule('i18n/index');
const root = new URL('../../', import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const en = await readJson('web/src/i18n/en.json'),
  zh = await readJson('web/src/i18n/zh-CN.json');
assert.deepEqual(
  Object.keys(en).sort(),
  Object.keys(zh).sort(),
  'Locale catalogs must have the same keys',
);
const tokens = (text) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
for (const key of Object.keys(en)) {
  for (const value of [en[key], zh[key]]) {
    assert(!/\$t\(|\{\{(?!\w+\}\})/.test(value), `Unsupported translation syntax: ${key}`);
  }
  assert(en[key].trim() && zh[key].trim(), `Empty translation: ${key}`);
  assert.deepEqual(tokens(en[key]), tokens(zh[key]), `Interpolation mismatch: ${key}`);
  assert(!/\p{Script=Han}/u.test(en[key]), `Chinese text in English translation: ${key}`);
}
const brands = new Set([
  'Language resources could not be loaded. Reload to retry. / 语言资源加载失败，请刷新重试。',
  'AGENT',
  'DECK',
  'AgentDeck',
  'English',
  '简体中文',
  'Windows',
  'Linux',
  'agentdeck restart',
  'agentdeck status --json',
]);
const failures = [];
async function scan(directory) {
  for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      await scan(path);
      continue;
    }
    if (!/\.(tsx?|js)$/.test(path)) continue;
    const source = await readFile(new URL(path, root), 'utf8');
    const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const fail = (node, text) =>
      failures.push(
        `${path}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${text}`,
      );
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(sf) === 't') {
        const key = node.arguments[0];
        if (key && ts.isStringLiteral(key) && !Object.hasOwn(en, key.text))
          fail(key, `Missing key: ${key.text}`);
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const translated =
          ts.isCallExpression(node.parent) &&
          node.parent.arguments[0] === node &&
          node.parent.expression.getText(sf) === 't';
        if (/\p{Script=Han}/u.test(node.text) && !translated && !brands.has(node.text))
          fail(node, `Unextracted text: ${node.text}`);
      }
      if (ts.isJsxText(node)) {
        const text = node.text.trim();
        if (/[a-zA-Z\p{Script=Han}]/u.test(text) && !brands.has(text))
          fail(node, `Untranslated JSX: ${text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }
}
await scan('web/src');
await scan('server/admin');
const html = await readFile(new URL('server/admin/index.html', root), 'utf8');
for (const [, key] of html.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g))
  assert(Object.hasOwn(en, key), `Missing admin HTML key: ${key}`);
assert.deepEqual(failures, [], 'Extract user-facing text to the catalogs');
for (const locale of ['en', 'zh-CN']) {
  setLanguagePreference(locale);
  assert.equal(
    t('files.changed', { count: 1 }),
    locale === 'en' ? '1 file changed' : '1 个文件已更改',
  );
  assert.equal(
    t('files.changed', { count: 2 }),
    locale === 'en' ? '2 files changed' : '2 个文件已更改',
  );
  assert.equal(t('unknown.key'), 'unknown.key');
  assert.equal(t('toString'), 'toString');
  assert(errorText('WORKSPACE_FORBIDDEN: unknown diagnostic').includes('unknown diagnostic'));
  const value = '<script>{{name}} & 用户</script>';
  assert(
    t('remove.project.confirm', { name: value }).includes(value),
    'Interpolation preserves user data verbatim; React/DOM render it as text',
  );
}
console.log(
  `i18n: ${Object.keys(en).length} bilingual messages; keys, parameters, plurals and source extraction passed`,
);
