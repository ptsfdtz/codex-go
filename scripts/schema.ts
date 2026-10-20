import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(resolve(root, e.name)) : [resolve(root, e.name)],
  );
}
const root = resolve('bridge/generated');
const entries = files(root)
  .sort()
  .map((path) => ({
    path: relative(root, path).replaceAll('\\', '/'),
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  }));
const content =
  JSON.stringify({ codexVersion: '0.159.2', experimental: false, files: entries }, null, 2) + '\n';
const target = resolve('bridge/schema-lock.json');
if (process.argv[2] === 'record') writeFileSync(target, content);
else if (readFileSync(target, 'utf8') !== content)
  throw new Error('Generated Codex schema differs from schema-lock.json');
console.log(
  `Verified ${entries.length} files; SHA256 ${createHash('sha256').update(content).digest('hex')}`,
);
