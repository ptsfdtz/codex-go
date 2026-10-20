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
