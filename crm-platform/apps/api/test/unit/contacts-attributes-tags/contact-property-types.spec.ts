import { describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import type { PropertyDef } from '../../../src/modules/crm/contacts/contact-property-values';
import { ContactsService } from '../../../src/modules/crm/contacts/contacts.service';

/**
 * Legacy #15148: a create or update of a contact accepted any value for a typed custom property ("abc" in a number property). The
 * bulk edit already held values to the type; the single create/update now does too, for the keys the request changes. No database.
 */
const def = (key: string, fieldType: string): PropertyDef => ({
  key,
  label: key,
  fieldType,
  options: [],
});
const defs = new Map([
  ['age', def('age', 'integer')],
  ['score', def('score', 'decimal')],
  ['joined', def('joined', 'date')],
  ['city', def('city', 'text')],
]);

const svc = Object.create(ContactsService.prototype) as Record<string, unknown>;
svc.repo = {
  definedPropertyKeys: async (_tx: unknown, _org: number, keys: string[]) =>
    new Set(keys.filter((k) => defs.has(k))),
  editableProperties: async (_tx: unknown, _org: number, keys: string[]) =>
    new Map(keys.filter((k) => defs.has(k)).map((k) => [k, defs.get(k)!])),
};

const check = (incoming: Record<string, unknown>, current: Record<string, unknown> = {}) =>
  RequestContextStore.run(
    { requestId: 't', orgId: 1, actorType: 'user', actorId: 1, userId: 1, grants: new Map() },
    () =>
      (
        svc as unknown as {
          assertPropertiesWritable(t: unknown, o: number, i: unknown, c: unknown): Promise<void>;
        }
      ).assertPropertiesWritable({}, 1, incoming, current),
  );

describe('typed contact property values on create and update', () => {
  it('refuses text in a number property and names the key', async () => {
    await expect(check({ age: 'abc' })).rejects.toThrow(/age/);
  });

  it('refuses a fraction in a whole-number property and a bad date', async () => {
    await expect(check({ age: 4.5 })).rejects.toThrow(/age/);
    await expect(check({ joined: '31/02/2026' })).rejects.toThrow(/joined/);
  });

  it('accepts values that fit, numeric text included', async () => {
    await expect(
      check({ age: '42', score: 7.5, joined: '2026-10-30', city: 'Pune' }),
    ).resolves.toBeUndefined();
  });

  it('lets a blank value clear the property', async () => {
    await expect(check({ age: '' })).resolves.toBeUndefined();
    await expect(check({ age: null })).resolves.toBeUndefined();
  });

  it('does not re-check a value the request leaves unchanged', async () => {
    await expect(check({ age: 'abc' }, { age: 'abc' })).resolves.toBeUndefined();
  });
});
