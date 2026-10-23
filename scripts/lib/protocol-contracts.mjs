import { createHash } from 'node:crypto';

// Stable object ordering prevents export formatting/key order from creating drift.
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const escapePointer = (value) => value.replaceAll('~', '~0').replaceAll('/', '~1');
const evidence = (value) => {
  const json = JSON.stringify(value);
  return json.length <= 2048
    ? value
    : { evidence: 'sha256-only', sha256: digest(value), jsonBytes: Buffer.byteLength(json) };
};

// Include every transitive definition, including cyclic ones, once. A method's
// own params $ref may stay unchanged while the referenced wire shape changes.
export function contract(document, branch) {
  const references = {};
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.$ref === 'string') {
      const ref = value.$ref;
      if (!ref.startsWith('#/')) throw new Error(`Unsupported schema reference: ${ref}`);
      if (!Object.hasOwn(references, ref)) {
        const target = ref
          .slice(2)
          .split('/')
          .reduce((node, key) => {
            const decoded = key.replaceAll('~1', '/').replaceAll('~0', '~');
            if (!node || !Object.hasOwn(node, decoded))
              throw new Error(`Missing schema reference: ${ref}`);
            return node[decoded];
          }, document);
        references[ref] = target;
        visit(target);
      }
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(branch);
  return canonical({ branch, references });
}

export function methodContracts(document) {
  const result = {};
  const branches = document.oneOf ?? document.anyOf;
  if (!Array.isArray(branches)) throw new Error('Missing top-level protocol variants');
  for (const branch of branches) {
    const shape = contract(document, branch);
    const method = branch.properties?.method;
    const names = method?.const ? [method.const] : method?.enum;
    if (!Array.isArray(names) || !names.length)
      throw new Error('Missing protocol method discriminator');
    for (const name of names) {
      if (Object.hasOwn(result, name)) throw new Error(`Duplicate protocol method: ${name}`);
      result[name] = shape;
    }
  }
  return result;
}

function differences(before, after, path = '') {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (
    before &&
    after &&
    !Array.isArray(before) &&
    !Array.isArray(after) &&
    typeof before === 'object' &&
    typeof after === 'object'
  ) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap((key) => {
      const pointer = `${path}/${escapePointer(key)}`;
      if (!Object.hasOwn(before, key))
        return [{ path: pointer, kind: 'added', after: evidence(after[key]) }];
      if (!Object.hasOwn(after, key))
        return [{ path: pointer, kind: 'removed', before: evidence(before[key]) }];
      return differences(before[key], after[key], pointer);
    });
  }
  return [{ path, kind: 'changed', before: evidence(before), after: evidence(after) }];
}

export function compareContracts(before, after) {
  const names = Object.keys(after).sort();
  return {
    count: names.length,
    added: names.filter((name) => !Object.hasOwn(before, name)),
    removed: Object.keys(before)
      .sort()
      .filter((name) => !Object.hasOwn(after, name)),
    unchanged: names.filter(
      (name) => Object.hasOwn(before, name) && digest(before[name]) === digest(after[name]),
    ),
    changed: names
      .filter((name) => Object.hasOwn(before, name) && digest(before[name]) !== digest(after[name]))
      .map((name) => ({
        name,
        beforeSha256: digest(before[name]),
        afterSha256: digest(after[name]),
        differences: differences(before[name], after[name]),
      })),
  };
}
