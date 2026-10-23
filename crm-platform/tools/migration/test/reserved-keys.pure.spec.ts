import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_FIELD_KEYS } from '../transform/fields';
import { propertyKeyOf, RESERVED_PROPERTY_KEYS, RESERVED_RENAME_PREFIX } from '../transform/contacts';

/** The keys the app reserves: SYSTEM_ATTRIBUTES plus RESERVED_ATTRIBUTE_KEYS in packages/contracts. Read as text, so this needs no build. */
const contracts = readFileSync(
  join(__dirname, '../../../packages/contracts/src/contacts-attributes-tags/attribute.ts'),
  'utf8',
);
const reservedFromContracts = (() => {
  const system = [...contracts.matchAll(/key: '([a-z_]+)'/g)].map((m) => m[1]);
  const start = contracts.indexOf('RESERVED_ATTRIBUTE_KEYS');
  const block = contracts.slice(start, contracts.indexOf(']);', start));
  const explicit = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  return [...new Set([...system, ...explicit])].sort();
})();

describe('reserved property keys', () => {
  it('the renamed list is exactly the reserved keys the built-in list does not cover', () => {
    const notBuiltIn = reservedFromContracts.filter((k) => !BUILT_IN_FIELD_KEYS.has(k));
    expect([...RESERVED_PROPERTY_KEYS].sort()).toEqual(notBuiltIn);
  });

  it('every reserved key is either built in or renamed, never created as is', () => {
    for (const k of reservedFromContracts) {
      const handled = BUILT_IN_FIELD_KEYS.has(k) || RESERVED_PROPERTY_KEYS.has(k);
      expect(handled, k).toBe(true);
    }
  });

  it('the places that name a property (flow ask steps, reconcile) use the same key', () => {
    const convert = readFileSync(join(__dirname, '../flows/wabo-convert.ts'), 'utf8');
    expect(convert).not.toContain('propertyKey: key,');
    expect(convert).toContain('propertyKey: propertyKeyOf(key)');
    const reconcile = readFileSync(join(__dirname, '../reconcile/index.ts'), 'utf8');
    expect(reconcile).toContain('propertyKeyOf(k)');
  });

  it('a reserved key gets the prefix, any other key keeps its name', () => {
    expect(propertyKeyOf('tags')).toBe(`${RESERVED_RENAME_PREFIX}tags`);
    expect(propertyKeyOf('name')).toBe(`${RESERVED_RENAME_PREFIX}name`);
    expect(propertyKeyOf('favourite_colour')).toBe('favourite_colour');
  });
});
