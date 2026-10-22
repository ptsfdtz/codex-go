// Verify the immutable, pinned CLI export; never silently rewrite hashes.
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
const root = resolve('packages/codex-protocol');
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(resolve(dir, entry.name)) : [resolve(dir, entry.name)],
  );
const bytes = readFileSync(resolve(root, 'schema-lock.json'));
const lock = JSON.parse(bytes);
if (lock.codexVersion !== '0.159.2' || lock.experimental !== false)
  throw new Error('Unexpected Codex schema version');
const actual = walk(resolve(root, 'schema'))
  .map((file) => ({
    path: relative(root, file).replaceAll('\\', '/'),
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
  }))
  .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
if (JSON.stringify(actual) !== JSON.stringify(lock.files))
  throw new Error('Codex JSON schemas differ from the reviewed manifest');
console.log(
  `Verified ${actual.length} schemas; manifest SHA256 ${createHash('sha256').update(bytes).digest('hex')}`,
);
const desktopRoot = resolve(root, 'versions/0.163.0-alpha.10.2');
const desktopLock = JSON.parse(readFileSync(resolve(desktopRoot, 'schema-lock.json')));
if (
  desktopLock.codexVersion !== '0.163.0-alpha.10.2' ||
  desktopLock.baseCodexVersion !== lock.codexVersion ||
  desktopLock.experimental !== false
)
  throw new Error('Unexpected desktop baseline manifest');
const names = new Set();
const overlays = [];
for (const file of desktopLock.files) {
  if (
    names.has(file.name) ||
    file.source.includes('..') ||
    file.source.includes('\\') ||
    ![
      `schema/${file.name}.json`,
      `versions/${desktopLock.codexVersion}/schema/${file.name}.json`,
    ].includes(file.source)
  ) {
    throw new Error('Invalid desktop schema source');
  }
  names.add(file.name);
  if (
    createHash('sha256')
      .update(readFileSync(resolve(root, file.source)))
      .digest('hex') !== file.sha256
  )
    throw new Error(`Desktop baseline schema differs: ${file.name}`);
  if (file.source.startsWith('versions/')) overlays.push(file.source);
}
const actualOverlays = walk(resolve(desktopRoot, 'schema'))
  .map((file) => relative(root, file).replaceAll('\\', '/'))
  .sort();
if (JSON.stringify(actualOverlays) !== JSON.stringify(overlays.sort()))
  throw new Error('Unindexed desktop schema overlay');
console.log(
  `Verified desktop ${desktopLock.codexVersion}: ${names.size} effective schemas, ${overlays.length} overlays`,
);
const composerLock = JSON.parse(readFileSync(resolve(desktopRoot, 'composer-lock.json')));
const expectedComposer = `versions/${desktopLock.codexVersion}/experimental/TurnStartParams.json`;
if (
  composerLock.codexVersion !== desktopLock.codexVersion ||
  composerLock.experimental !== true ||
  composerLock.files.length !== 1 ||
  composerLock.files[0].source !== expectedComposer ||
  createHash('sha256')
    .update(readFileSync(resolve(root, expectedComposer)))
    .digest('hex') !== composerLock.files[0].sha256
) {
  throw new Error('Desktop experimental composer schema differs');
}
console.log('Verified desktop experimental TurnStartParams');

const queueLock = JSON.parse(readFileSync(resolve(desktopRoot, 'queue-lock.json')));
if (
  queueLock.codexVersion !== desktopLock.codexVersion ||
  queueLock.experimental !== true ||
  queueLock.files.length !== 10
)
  throw new Error('Invalid queue schema lock');
for (const operation of ['Add', 'List', 'Update', 'Delete', 'Reorder'])
  for (const kind of ['Params', 'Response']) {
    const name = `ThreadQueue${operation}${kind}`;
    const file = queueLock.files.find((file) => file.name === name);
    const source = `versions/${desktopLock.codexVersion}/experimental/${name}.json`;
    if (
      !file ||
      file.source !== source ||
      createHash('sha256')
        .update(readFileSync(resolve(root, source)))
        .digest('hex') !== file.sha256
    )
      throw new Error(`Queue schema differs: ${name}`);
  }
console.log('Verified desktop experimental queue contracts');

const startLock = JSON.parse(readFileSync(resolve(desktopRoot, 'queue-start-lock.json')));
if (
  startLock.codexVersion !== desktopLock.codexVersion ||
  startLock.experimental !== true ||
  startLock.files.length !== 2
)
  throw new Error('Invalid queue start lock');
for (const kind of ['Params', 'Response']) {
  const name = `ThreadQueueStart${kind}`;
  const file = startLock.files.find((file) => file.name === name);
  const source = `versions/${desktopLock.codexVersion}/experimental/${name}.json`;
  if (
    !file ||
    file.source !== source ||
    createHash('sha256')
      .update(readFileSync(resolve(root, source)))
      .digest('hex') !== file.sha256
  )
    throw new Error(`Queue start schema differs: ${name}`);
}
console.log('Verified desktop experimental queue start contracts');
