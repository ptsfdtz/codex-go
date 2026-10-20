import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv, type ValidateFunction } from 'ajv';
import { DeckError } from './errors.js';

const root = fileURLToPath(new URL('../generated/schema/', import.meta.url));
const ajv = new Ajv({ strict: false, allErrors: false, validateFormats: false });
const validators = new Map<string, ValidateFunction>();
export function validateContract(name: string, value: unknown): void {
  let validator = validators.get(name);
  if (!validator) {
    const path = name.includes('/') ? `${root}${name}.json` : `${root}${name}.json`;
    validator = ajv.compile(JSON.parse(readFileSync(path, 'utf8')) as object);
    validators.set(name, validator);
  }
  if (!validator(value)) throw new DeckError('UPSTREAM_PROTOCOL_ERROR', `Invalid upstream ${name}`);
}
