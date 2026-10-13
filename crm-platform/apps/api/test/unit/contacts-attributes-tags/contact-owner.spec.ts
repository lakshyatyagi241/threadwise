import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assigneeResponseSchema,
  bulkOwnerContactsSchema,
  contactFilterToRules,
  createContactSchema,
  listContactsQuerySchema,
  segmentFromFiltersSchema,
  segmentRulesSchema,
  updateContactSchema,
} from '@crm/contracts';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { contactConditions } from '../../../src/modules/crm/contacts/contact-conditions';

const id = () => randomUUID();

describe('owner on create and update', () => {
  it('create: omitted means the creator, null means nobody, a uuid names a person', () => {
    expect(
      createContactSchema.parse({ firstName: 'A', phone: '+919876543210' }).ownerId,
    ).toBeUndefined();
    expect(
      createContactSchema.parse({ firstName: 'A', phone: '+919876543210', ownerId: null }).ownerId,
    ).toBeNull();
    const o = id();
    expect(
      createContactSchema.parse({ firstName: 'A', phone: '+919876543210', ownerId: o }).ownerId,
    ).toBe(o);
    expect(
      createContactSchema.safeParse({ firstName: 'A', phone: '+919876543210', ownerId: 'bob' })
        .success,
    ).toBe(false);
  });

  it('update: absent keeps, null clears', () => {
    expect(updateContactSchema.parse({ rowVersion: 1 }).ownerId).toBeUndefined();
    expect(updateContactSchema.parse({ rowVersion: 1, ownerId: null }).ownerId).toBeNull();
  });

  it('the owner picker carries what the caller may assign', () => {
    expect(
      assigneeResponseSchema.safeParse({
        id: id(),
        fullName: 'A',
        email: 'a@x.test',
        canAssign: true,
      }).success,
    ).toBe(true);
    expect(
      assigneeResponseSchema.safeParse({ id: id(), fullName: 'A', email: 'a@x.test' }).success,
    ).toBe(false);
  });
});

describe('owner filter shape', () => {
  it('reads several people from a query string and "nobody" as a boolean', () => {
    const a = id();
    const b = id();
    const q = listContactsQuerySchema.parse({ ownerIds: `${a},${b}`, unassigned: 'true' });
    expect(q.ownerIds).toEqual([a, b]);
    expect(q.unassigned).toBe(true);
    expect(listContactsQuerySchema.parse({ unassigned: 'false' }).unassigned).toBe(false);
    expect(listContactsQuerySchema.safeParse({ ownerIds: 'nope' }).success).toBe(false);
  });

  it('is part of every bulk selection, so "select all N" of one owner can be reassigned', () => {
    const a = id();
    const body = bulkOwnerContactsSchema.parse({ filter: { ownerIds: [a] }, ownerId: id() });
    expect(body.filter?.ownerIds).toEqual([a]);
    expect(bulkOwnerContactsSchema.parse({ ids: [id()], ownerId: null }).ownerId).toBeNull();
  });

  it('a bulk owner request needs exactly one selector and an explicit owner (or null)', () => {
    expect(bulkOwnerContactsSchema.safeParse({ ownerId: id() }).success).toBe(false);
    expect(
      bulkOwnerContactsSchema.safeParse({ ids: [id()], filter: {}, ownerId: id() }).success,
    ).toBe(false);
    expect(bulkOwnerContactsSchema.safeParse({ ids: [id()] }).success).toBe(false);
  });
});

describe('owner filter as segment rules', () => {
  const rules = (filter: Record<string, unknown>) =>
    contactFilterToRules(segmentFromFiltersSchema.parse({ name: 'x', filter }).filter);

  it('people alone become one "in" condition, nobody alone "is empty"', () => {
    const a = id();
    const b = id();
    const people = rules({ ownerIds: [a, b] })!;
    expect(segmentRulesSchema.safeParse(people).success).toBe(true);
    expect(people.children).toEqual([
      { type: 'condition', field: 'owner', operator: 'in', value: [a, b] },
    ]);
    expect(rules({ unassigned: true })!.children).toEqual([
      { type: 'condition', field: 'owner', operator: 'is_empty' },
    ]);
  });

  it('people together with nobody become an OR group inside the AND of the other parts', () => {
    const a = id();
    const out = rules({ ownerIds: [a], unassigned: true, q: 'sharma' })!;
    expect(segmentRulesSchema.safeParse(out).success).toBe(true);
    expect(out.combinator).toBe('and');
    expect(out.children).toContainEqual({
      type: 'group',
      combinator: 'or',
      children: [
        { type: 'condition', field: 'owner', operator: 'in', value: [a] },
        { type: 'condition', field: 'owner', operator: 'is_empty' },
      ],
    });
  });
});

describe('owner filter SQL', () => {
  const dialect = new PgDialect();
  const render = (ownerAny: { ids: number[]; unassigned: boolean }) =>
    dialect
      .sqlToQuery(
        sql.join(
          contactConditions(1, { includeArchived: true, tagMode: 'any', ownerAny }, undefined),
          sql` AND `,
        ),
      )
      .sql.toLowerCase();

  it('people: owner in the list', () => {
    expect(render({ ids: [3, 4], unassigned: false })).toContain('"owner_id" in (');
  });

  it('nobody: owner is null; both: either, in one parenthesis', () => {
    expect(render({ ids: [], unassigned: true })).toContain('"owner_id" is null');
    const both = render({ ids: [3], unassigned: true });
    expect(both).toMatch(
      /\("contacts"\."owner_id" in \(\$\d+\) or "contacts"\."owner_id" is null\)/,
    );
  });

  it('nothing known and nobody not asked for matches nothing rather than everything', () => {
    expect(render({ ids: [], unassigned: false })).toContain('false');
  });
});
