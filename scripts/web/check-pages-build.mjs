import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const repository = process.env.GITHUB_REPOSITORY?.split('/')[1];
assert(repository, 'GITHUB_REPOSITORY must identify the Pages repository');
const base = `/${repository}/`;
const directory = resolve('web/dist');
const html = readFileSync(resolve(directory, 'index.html'), 'utf8');
const references = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
assert(
  references.some((value) => value.endsWith('.js')),
  'Pages must load a JavaScript entry',
);
for (const reference of references) {
  assert(reference.startsWith(base), `Pages asset has the wrong base path: ${reference}`);
  const file = resolve(directory, decodeURIComponent(reference.slice(base.length)));
  assert(
    file.startsWith(directory + sep),
    `Pages asset escapes the output directory: ${reference}`,
  );
  assert(statSync(file).isFile(), `Pages asset is missing: ${reference}`);
}
console.log(`Pages: ${references.length} entry assets verified under ${base}`);
