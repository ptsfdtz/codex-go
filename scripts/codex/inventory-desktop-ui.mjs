// Static installed-resource inventory. Never executes bundled JavaScript or reads user data.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute } from 'node:path';
const [archivePath, destination, packageLabel, ...extra] = process.argv.slice(2);
if (extra.length || ![archivePath, destination].every((p) => p && isAbsolute(p)) || !packageLabel)
  throw new Error('Expected absolute archive/report paths and package label');
const archive = readFileSync(archivePath);
const headerLength = archive.readUInt32LE(12);
if (headerLength > 64 * 1024 * 1024 || 16 + headerLength > archive.length)
  throw new Error('Invalid ASAR header');
const tree = JSON.parse(archive.subarray(16, 16 + headerLength).toString('utf8'));
const assets = tree.files?.webview?.files?.assets?.files;
if (!assets) throw new Error('Unknown desktop webview layout');
const base = 8 + archive.readUInt32LE(4);
const targets = [
  'settings-page', 'settings-command-menu-section-items', 'use-visible-settings-sections',
  'settings-host-dropdown', 'keyboard-shortcut-command-order', 'keyboard-shortcuts-dialog',
  'sidebar-actions', 'app-settings',
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const modules = targets.map((target) => {
  const names = Object.keys(assets).filter((name) => name.startsWith(`${target}-`) && name.endsWith('.js'));
  if (names.length !== 1) throw new Error(`Ambiguous or missing UI module: ${target}`);
  const name = names[0], entry = assets[name];
  if (entry.unpacked || !/^\d+$/.test(entry.offset) || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > 32 * 1024 * 1024)
    throw new Error(`Unsupported UI entry: ${name}`);
  const start = base + Number(entry.offset);
  if (!Number.isSafeInteger(start) || start < base || start + entry.size > archive.length)
    throw new Error(`UI entry outside archive: ${name}`);
  const bytes = archive.subarray(start, start + entry.size), source = bytes.toString('utf8');
  const messages = [...source.matchAll(/id:\s*([`"])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*defaultMessage:\s*([`"])((?:\\.|(?!\3)[^\\])*)\3/g)]
    .map((match) => ({ id: match[2], defaultMessageSource: match[4], byteOffset: Buffer.byteLength(source.slice(0, match.index), 'utf8') }));
  const routes = [...new Set([...source.matchAll(/[`"](\/settings[^`"]*)[`"]/g)].map((match) => match[1]))].sort();
  const sectionCandidates = [...new Set([...source.matchAll(/slug:\s*[`"]([^`"]+)[`"]/g)].map((match) => match[1]))].sort();
  const visibilityCaseCandidates = target === 'use-visible-settings-sections'
    ? [...new Set([...source.matchAll(/case[`"]([^`"]+)[`"]:/g)].map((match) => match[1]))].sort() : [];
  const orderMatch = target === 'use-visible-settings-sections'
    ? source.match(/\[\x60profile\x60,\x60agent\x60,\x60personalization\x60,([^\]]+)\]/) : null;
  const settingsOrderCandidate = orderMatch
    ? [...orderMatch[0].matchAll(/`([^`]+)`/g)].map((match) => match[1]) : null;
  return { module: `webview/assets/${name}`, sha256: hash(bytes), size: bytes.length, messages, routes, sectionCandidates, visibilityCaseCandidates, settingsOrderCandidate };
});
const report = {
  packageLabel,
  evidenceLevel: 'static-bundled-definition-not-rendered-or-enabled',
  archiveSha256: hash(archive),
  boundary: 'Contains shared Codex and ChatGPT resources. Definitions do not establish account, experiment, platform availability or locked-version parity. No bundled code executed; no profiles, credentials or conversation databases read.',
  modules,
};
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ modules: modules.length, messages: modules.reduce((n, m) => n + m.messages.length, 0), sections: modules.reduce((n, m) => n + m.sectionCandidates.length, 0) }));
