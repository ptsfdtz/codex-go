// Load real TypeScript feature modules for Node tests, including their locale
// catalogs. No mock translator, browser state, or production API is needed.
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ts from 'typescript';
const requireWeb = createRequire(new URL('../../web/package.json', import.meta.url));
const cache = new Map();
async function moduleUrl(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  const source = await readFile(url, 'utf8');
  let output;
  if (url.pathname.endsWith('.json')) output = `export default ${source}`;
  else
    output = ts
      .transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      })
      .outputText.replaceAll('import.meta.env.BASE_URL', "'/'");
  const parsed = ts.createSourceFile('module.js', output, ts.ScriptTarget.Latest, true);
  const patches = [];
  for (const statement of parsed.statements) {
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) continue;
    let target;
    if (specifier.text.startsWith('.')) {
      target = new URL(specifier.text, url);
      if (!/\.(ts|tsx|json)$/.test(target.pathname)) {
        try {
          await stat(fileURLToPath(target) + '.ts');
          target = pathToFileURL(fileURLToPath(target) + '.ts');
        } catch {
          target = new URL(target.href + '/index.ts');
        }
      }
      target = await moduleUrl(target);
    } else target = pathToFileURL(requireWeb.resolve(specifier.text)).href;
    patches.push([specifier.getStart(parsed), specifier.end, JSON.stringify(target)]);
  }
  for (const [start, end, value] of patches.reverse())
    output = output.slice(0, start) + value + output.slice(end);
  const result = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
  cache.set(url.href, result);
  return result;
}
export async function loadWebModule(path) {
  return import(await moduleUrl(new URL(`../../web/src/${path}.ts`, import.meta.url)));
}
