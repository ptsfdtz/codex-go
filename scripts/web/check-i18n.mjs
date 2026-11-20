import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { loadWebModule } from './load-web-module.mjs';
import { adminCatalog } from '../../server/admin-locales.ts';
import { translations } from '../../web/src/i18n/config.ts';
import ts from 'typescript';
const { t, setLanguagePreference, errorText } = await loadWebModule('i18n/index');
const root = new URL('../../', import.meta.url);
const { en, 'zh-CN': zh } = translations;
const adminEn = adminCatalog('en');
const adminZh = adminCatalog('zh-CN');
const catalogDirectories = new Set(
  Object.keys(translations).map((locale) => `web/src/i18n/${locale}`),
);
// A spread in a locale index can silently overwrite another module's message.
for (const [locale, catalog] of Object.entries(translations)) {
  const directory = new URL(`web/src/i18n/${locale}/`, root);
  const owners = new Map();
  for (const file of await readdir(directory)) {
    if (file === 'index.ts' || !file.endsWith('.ts')) continue;
    const { default: messages } = await import(new URL(file, directory).href);
    for (const key of Object.keys(messages)) {
      assert(!owners.has(key), `${locale}: ${key} occurs in both ${owners.get(key)} and ${file}`);
      owners.set(key, file);
    }
  }
  assert.deepEqual(
    [...owners.keys()].sort(),
    Object.keys(catalog).sort(),
    `Unregistered messages: ${locale}`,
  );
}
assert.deepEqual(
  Object.keys(en).sort(),
  Object.keys(zh).sort(),
  'Locale catalogs must have the same keys',
);
assert.deepEqual(
  Object.keys(adminEn).sort(),
  Object.keys(adminZh).sort(),
  'Admin catalogs must have the same keys, including aliases for cached clients',
);
for (const [key, value] of Object.entries(en)) {
  assert.equal(adminEn[key], value, `Admin English differs from Web: ${key}`);
  assert.equal(adminZh[key], zh[key], `Admin Chinese differs from Web: ${key}`);
}
assert.equal(adminEn['后台审批和提问提醒'], en['push.approvals']);
assert.equal(adminZh['后台审批和提问提醒'], zh['push.approvals']);
const tokens = (text) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
for (const key of Object.keys(en)) {
  for (const value of [en[key], zh[key]]) {
    assert.equal(typeof value, 'string', `Expected text: ${key}`);
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
async function scan(directory, catalog) {
  for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      await scan(path, catalog);
      continue;
    }
    if (!/\.(tsx?|js)$/.test(path)) continue;
    if (catalogDirectories.has(directory) && path.endsWith('.ts')) continue;
    const source = await readFile(new URL(path, root), 'utf8');
    const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const fail = (node, text) =>
      failures.push(
        `${path}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${text}`,
      );
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(sf) === 't') {
        const key = node.arguments[0];
        if (key && ts.isStringLiteral(key) && !Object.hasOwn(catalog, key.text))
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
await scan('web/src', en);
await scan('server/admin', adminEn);
const html = await readFile(new URL('server/admin/index.html', root), 'utf8');
for (const [, key] of html.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g))
  assert(Object.hasOwn(adminEn, key), `Missing admin HTML key: ${key}`);
assert.deepEqual(failures, [], 'Extract user-facing text to the catalogs');
const pluralKeys = new Set(
  Object.keys(en).flatMap((key) => {
    const match = /^(.*)_(one|other|zero)$/.exec(key);
    return match ? [match[1]] : [];
  }),
);
for (const [locale, catalog] of Object.entries(translations)) {
  setLanguagePreference(locale);
  const rules = new Intl.PluralRules(locale);
  for (const key of pluralKeys) {
    assert(Object.hasOwn(catalog, key), `Missing plural base: ${locale} ${key}`);
    for (const count of [0, 1, 2]) {
      const category =
        count === 0 && Object.hasOwn(catalog, `${key}_zero`) ? 'zero' : rules.select(count);
      const variant = catalog[`${key}_${category}`];
      assert(variant, `Missing plural variant: ${locale} ${key}_${category}`);
      assert.equal(t(key, { count }), variant.replaceAll('{{count}}', String(count)));
    }
  }
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
