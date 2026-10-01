import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BULK_IDS_MAX,
  bulkDeleteContactsSchema,
  bulkGroupContactsSchema,
  bulkTagContactsSchema,
  createContactGroupSchema,
  exportContactsSchema,
  listContactsQuerySchema,
  updateContactGroupSchema,
  createTagSchema,
  attachContactTagSchema,
} from '@crm/contracts';
import {
  csvCell,
  csvLine,
  guardFormula,
  UTF8_BOM,
} from '../../../src/modules/crm/contact-bulk/csv-writer';

const id = () => randomUUID();

describe('contact list query (WD-CON-001..006)', () => {
  it('WD-CON-005: any page size up to 1000 is accepted; the default is 50; 1001 is not', () => {
    expect(listContactsQuerySchema.parse({}).limit).toBe(50);
    expect(listContactsQuerySchema.parse({ limit: '1000' }).limit).toBe(1000);
    expect(listContactsQuerySchema.safeParse({ limit: '1001' }).success).toBe(false);
  });

  it('reads query-string booleans properly: "false" is false (z.coerce.boolean made it true)', () => {
    const q = listContactsQuerySchema.parse({
      imported: 'false',
      unsubscribed: 'true',
      noGroup: '0',
      includeArchived: 'false',
    });
    expect(q.imported).toBe(false);
    expect(q.unsubscribed).toBe(true);
    expect(q.noGroup).toBe(false);
    expect(q.includeArchived).toBe(false);
  });

  it('WD-CON-004: tagIds is a comma list in a query string, and tagMode defaults to any', () => {
    const a = id();
    const b = id();
    const q = listContactsQuerySchema.parse({ tagIds: `${a},${b}` });
    expect(q.tagIds).toEqual([a, b]);
    expect(q.tagMode).toBe('any');
    expect(listContactsQuerySchema.parse({ tagIds: a, tagMode: 'all' }).tagMode).toBe('all');
  });

  it('WD-CON-004 #3: a tag that is not a uuid is a validation error, not silently ignored', () => {
    expect(listContactsQuerySchema.safeParse({ tagId: 'abc' }).success).toBe(false);
  });

  it('WD-CON-003: a group and "no group" together make no sense and are rejected', () => {
    expect(listContactsQuerySchema.safeParse({ groupId: id(), noGroup: 'true' }).success).toBe(
      false,
    );
    expect(listContactsQuerySchema.safeParse({ groupId: id() }).success).toBe(true);
  });

  it('expand takes groups, tags or both', () => {
    expect(listContactsQuerySchema.parse({ expand: 'groups,tags' }).expand).toEqual([
      'groups',
      'tags',
    ]);
    expect(listContactsQuerySchema.safeParse({ expand: 'owner' }).success).toBe(false);
  });

  it('the older shape (limit, cursor, order, q, ownerId, lifecycleStage) still parses', () => {
    const q = listContactsQuerySchema.parse({
      limit: 20,
      order: 'asc',
      q: 'x',
      lifecycleStage: 'new',
    });
    expect(q).toMatchObject({ limit: 20, order: 'asc', q: 'x', lifecycleStage: 'new' });
  });
});

describe('bulk selection (WD-CON-019)', () => {
  it('WD-CON-019: every bulk action takes ids OR a filter, never both and never neither', () => {
    for (const schema of [bulkDeleteContactsSchema, exportContactsSchema]) {
      expect(schema.safeParse({ ids: [id()] }).success).toBe(true);
      expect(schema.safeParse({ filter: { q: 'acme' } }).success).toBe(true);
      expect(schema.safeParse({ ids: [id()], filter: {} }).success).toBe(false);
      expect(schema.safeParse({}).success).toBe(false);
    }
    expect(
      bulkGroupContactsSchema.safeParse({ filter: {}, groupId: id(), action: 'add' }).success,
    ).toBe(true);
    expect(
      bulkTagContactsSchema.safeParse({ filter: {}, action: 'remove', name: 'VIP' }).success,
    ).toBe(true);
  });

  it('the older `{ ids }` body of POST /contacts/bulk/delete is still valid', () => {
    expect(bulkDeleteContactsSchema.safeParse({ ids: [id(), id()] }).success).toBe(true);
  });

  it('an explicit id list is capped, a filter is not', () => {
    const many = Array.from({ length: BULK_IDS_MAX + 1 }, id);
    expect(bulkDeleteContactsSchema.safeParse({ ids: many }).success).toBe(false);
    expect(bulkDeleteContactsSchema.safeParse({ ids: [] }).success).toBe(false);
  });

  it('"select all matching" can exclude the rows the user un-ticked, and the filter fills its defaults', () => {
    const r = bulkGroupContactsSchema.parse({
      filter: { q: 'acme', groupId: id() },
      excludeIds: [id()],
      groupId: id(),
      action: 'add',
    });
    expect(r.excludeIds).toHaveLength(1);
    expect(r.filter?.tagMode).toBe('any');
    expect(r.filter?.includeArchived).toBe(false);
  });

  it('WD-CON-021: the export asks for a BOM unless told otherwise', () => {
    expect(exportContactsSchema.parse({ ids: [id()] }).bom).toBe(true);
    expect(exportContactsSchema.parse({ ids: [id()], bom: false }).bom).toBe(false);
  });

  it('WD-CON-023: the group action is add or remove, with a group uuid', () => {
    expect(
      bulkGroupContactsSchema.safeParse({ ids: [id()], groupId: 'x', action: 'add' }).success,
    ).toBe(false);
    expect(
      bulkGroupContactsSchema.safeParse({ ids: [id()], groupId: id(), action: 'move' }).success,
    ).toBe(false);
  });
});

describe('CSV writer (WD-CON-021)', () => {
  it('WD-CON-021 #2: a free-text cell beginning with = + - or @ gets a leading apostrophe', () => {
    expect(guardFormula('=cmd')).toBe("'=cmd");
    expect(guardFormula('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(guardFormula('-1+1')).toBe("'-1+1");
    expect(guardFormula('Aarav')).toBe('Aarav');
  });

  it('WD-CON-021: an E.164 number is NOT guarded because phone cells skip the guard (WaDesk wrote "\'+91...")', () => {
    // the exporter only guards free text; this documents that the guard itself would touch a "+"
    expect(guardFormula('+919812345678')).toBe("'+919812345678");
    expect(csvCell('+919812345678')).toBe('+919812345678');
  });

  it('quotes cells with commas, quotes and line breaks, and ends lines with \\n', () => {
    expect(csvLine(['a', 'b,c', 'say "x"', 'l1\nl2', null, 3, true])).toBe(
      'a,"b,c","say ""x""","l1\nl2",,3,true\n',
    );
  });

  it('WD-CON-021: a BOM is the UTF-8 byte-order mark', () => {
    expect(UTF8_BOM.charCodeAt(0)).toBe(0xfeff);
  });
});

describe('group and tag shapes (WD-CON-034, 035, 039)', () => {
  it('WD-CON-034 #3: a group needs a name; a name is trimmed and capped at 191', () => {
    expect(createContactGroupSchema.safeParse({}).success).toBe(false);
    expect(createContactGroupSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createContactGroupSchema.parse({ name: '  Leads ' }).name).toBe('Leads');
    expect(createContactGroupSchema.safeParse({ name: 'x'.repeat(192) }).success).toBe(false);
  });

  it('WD-CON-034: the colour is a hex value (WaDesk accepted any 32 characters); the note is capped at 500', () => {
    expect(createContactGroupSchema.safeParse({ name: 'A', color: '#22C55E' }).success).toBe(true);
    expect(createContactGroupSchema.safeParse({ name: 'A', color: 'green' }).success).toBe(false);
    expect(createContactGroupSchema.safeParse({ name: 'A', note: 'n'.repeat(501) }).success).toBe(
      false,
    );
  });

  it('WD-CON-035: an update keeps what it does not mention and clears with null; it needs the row version', () => {
    const keep = updateContactGroupSchema.parse({ name: 'B', rowVersion: 1 });
    expect(keep.note).toBeUndefined();
    const clear = updateContactGroupSchema.parse({ note: null, rowVersion: 1 });
    expect(clear.note).toBeNull();
    expect(updateContactGroupSchema.safeParse({ name: 'B' }).success).toBe(false);
  });

  it('WD-CON-039: a tag name is at most 64 characters (WaDesk validated 80 against a 64 character column)', () => {
    expect(createTagSchema.safeParse({ name: 'x'.repeat(64) }).success).toBe(true);
    expect(createTagSchema.safeParse({ name: 'x'.repeat(65) }).success).toBe(false);
    expect(attachContactTagSchema.safeParse({ name: 'x'.repeat(65) }).success).toBe(false);
  });

  it('WD-CON-039 #4: attaching needs a tag id or a name', () => {
    expect(attachContactTagSchema.safeParse({}).success).toBe(false);
    expect(attachContactTagSchema.safeParse({ tagId: id() }).success).toBe(true);
    expect(attachContactTagSchema.safeParse({ name: 'Hot Lead' }).success).toBe(true);
  });
});
