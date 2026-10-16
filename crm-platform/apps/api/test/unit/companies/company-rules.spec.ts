import { describe, expect, it } from 'vitest';
import {
  bulkCompanyIdsSchema,
  createCompanySchema,
  linkCompanyContactsSchema,
  listCompaniesQuerySchema,
  updateCompanySchema,
} from '@crm/contracts';
import {
  dealRollup,
  companyRollup,
  toCompanyResponse,
} from '../../../src/modules/crm/companies/companies.mapper';
import {
  companyScopeCondition,
  type CompanyRow,
} from '../../../src/modules/crm/companies/companies.repository';
import {
  decodeCompanyCursor,
  decodeIdCursor,
  companySortId,
  encodeCompanyCursor,
  encodeIdCursor,
  escapeLike,
  foldActivity,
} from '../../../src/modules/crm/companies/company-rules';

describe('escapeLike (TW-CTP-002)', () => {
  it('a typed % or _ is a letter, not a wildcard', () => {
    expect(escapeLike('50%_off')).toBe('50\\%\\_off');
    expect(escapeLike('a\\b')).toBe('a\\\\b');
    expect(escapeLike('plain')).toBe('plain');
  });
});

describe('the list cursor (TW-CTP-002)', () => {
  it('round-trips a created key with microseconds and a name key with a pipe in it', () => {
    const created = encodeCompanyCursor('created:desc', '2026-10-05T10:00:00.123456Z', 42);
    expect(decodeCompanyCursor(created, 'created:desc', 'created')).toEqual({
      key: '2026-10-05T10:00:00.123456Z',
      id: 42,
    });
    const name = encodeCompanyCursor('name:asc', 'acme | sons', 7);
    expect(decodeCompanyCursor(name, 'name:asc', 'text')).toEqual({ key: 'acme | sons', id: 7 });
  });

  it('a cursor from one sort or direction cannot be replayed against another', () => {
    const created = encodeCompanyCursor('created:desc', '2026-10-05T10:00:00.000000Z', 1);
    expect(() => decodeCompanyCursor(created, 'name:asc', 'text')).toThrow(/pagination cursor/);
    expect(() => decodeCompanyCursor(created, 'created:asc', 'created')).toThrow(
      /pagination cursor/,
    );
    const byTier = encodeCompanyCursor('property:tier:asc', 'gold', 3);
    expect(() => decodeCompanyCursor(byTier, 'property:plan:asc', 'text')).toThrow(
      /pagination cursor/,
    );
  });

  it('names an order and its direction', () => {
    expect(companySortId('created', undefined, 'desc')).toBe('created:desc');
    expect(companySortId('property', 'tier', 'asc')).toBe('property:tier:asc');
  });

  it('garbage is a 400, not a 500', () => {
    for (const raw of [
      '',
      '!!!',
      Buffer.from('[1,2]').toString('base64url'),
      Buffer.from('{"a":1}').toString('base64url'),
    ]) {
      expect(() => decodeCompanyCursor(raw, 'created:desc', 'created')).toThrow(
        /pagination cursor/,
      );
    }
    expect(() =>
      decodeCompanyCursor(
        encodeCompanyCursor('created:desc', 'not a date', 1),
        'created:desc',
        'created',
      ),
    ).toThrow(/pagination cursor/);
  });

  it('a key is checked against the type it will be cast to, so a crafted cursor is a 400 and never SQL', () => {
    const num = (key: string) => encodeCompanyCursor('property:seats:asc', key, 1);
    expect(decodeCompanyCursor(num('12.5'), 'property:seats:asc', 'numeric').key).toBe('12.5');
    expect(decodeCompanyCursor(num('-1e30'), 'property:seats:asc', 'numeric').key).toBe('-1e30');
    expect(() =>
      decodeCompanyCursor(num('1; DROP TABLE companies'), 'property:seats:asc', 'numeric'),
    ).toThrow(/pagination cursor/);
    const when = (key: string) => encodeCompanyCursor('property:renewal:asc', key, 1);
    expect(decodeCompanyCursor(when('-infinity'), 'property:renewal:asc', 'timestamptz').key).toBe(
      '-infinity',
    );
    expect(() =>
      decodeCompanyCursor(when('tomorrow-ish'), 'property:renewal:asc', 'timestamptz'),
    ).toThrow(/pagination cursor/);
  });

  it('the contact list cursor is the last id', () => {
    expect(decodeIdCursor(encodeIdCursor(99))).toBe(99);
    expect(() => decodeIdCursor(Buffer.from('9; DROP').toString('base64url'))).toThrow(
      /pagination cursor/,
    );
  });
});

describe('foldActivity (TW-CTP-007)', () => {
  const at = new Date('2026-10-05T10:00:00Z');
  it('lists the changed fields of a row in reading order and resolves the values it is given', () => {
    const entries = foldActivity(
      [
        {
          action: 'update',
          actor: { id: 'u1', name: 'Asha' },
          at,
          delta: {
            notes: { old: null, new: 'x' },
            owner: { old: 'uuid-a', new: 'uuid-b' },
            name: { old: 'Acme', new: 'Acme Ltd' },
            zeta: { old: 1, new: 2 },
          },
        },
      ],
      (field, v) => (field === 'owner' ? `name-of-${String(v)}` : v),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.changes.map((c) => c.field)).toEqual(['name', 'notes', 'owner', 'zeta']);
    expect(entries[0]!.changes[2]).toEqual({
      field: 'owner',
      old: 'name-of-uuid-a',
      new: 'name-of-uuid-b',
    });
    expect(entries[0]!.at).toBe(at.toISOString());
    expect(entries[0]!.actor).toEqual({ id: 'u1', name: 'Asha' });
  });

  it('a row without a delta has no changes, and an unknown action reads as an update', () => {
    const [e] = foldActivity([{ action: 'merge', actor: null, at, delta: null }], (_f, v) => v);
    expect(e).toMatchObject({ action: 'update', actor: null, changes: [] });
  });
});

describe('the rollup (TW-CTP-003, 004)', () => {
  it('sums open and won deals per currency, never across currencies', () => {
    const r = dealRollup([
      { status: 'open', currency: 'USD', n: 2, total: 10_000n },
      { status: 'won', currency: 'USD', n: 1, total: 5_050n },
      { status: 'won', currency: 'JPY', n: 1, total: 700n },
      { status: 'lost', currency: 'USD', n: 3, total: 999n },
    ]);
    expect(r.total).toBe(7);
    expect(r.open).toBe(2);
    expect(r.won).toBe(2);
    expect(r.openValue).toEqual([{ currency: 'USD', amount: '100.00' }]);
    // JPY has no minor unit: 700 is 700, not 7.00 (Reference divided every currency by 100).
    expect(r.wonValue).toEqual([
      { currency: 'JPY', amount: '700' },
      { currency: 'USD', amount: '50.50' },
    ]);
  });

  it('a kind of record the caller cannot read has no figure, not a zero', () => {
    const counts = { contacts: 3, deals: [{ status: 'open', currency: 'USD', n: 1, total: 100n }] };
    expect(companyRollup(counts, { contacts: false, deals: false })).toEqual({
      contacts: null,
      deals: null,
    });
    expect(companyRollup(counts, { contacts: true, deals: false })).toEqual({
      contacts: 3,
      deals: null,
    });
    expect(companyRollup(undefined, { contacts: true, deals: true })).toMatchObject({
      contacts: 0,
      deals: { total: 0, open: 0, won: 0, openValue: [], wonValue: [] },
    });
  });

  it('the response carries uuids and names, never an internal id', () => {
    const row: CompanyRow = {
      id: 5,
      uuid: '11111111-1111-4111-8111-111111111111',
      displayId: 'COM-00001',
      name: 'Acme',
      nameKey: 'acme',
      sortKey: null,
      createdAtIso: '2026-10-05T10:00:00.000000Z',
      website: 'acme.test',
      email: null,
      phone: null,
      industry: null,
      sizeRange: null,
      address: null,
      notes: null,
      data: { tier: 'gold' },
      ownerId: 9,
      ownerUuid: '22222222-2222-4222-8222-222222222222',
      ownerName: 'Asha',
      createdById: null,
      createdByUuid: null,
      createdByName: null,
      rowVersion: 3,
      createdAt: new Date('2026-10-05T10:00:00Z'),
      updatedAt: new Date('2026-10-05T10:00:00Z'),
    };
    const res = toCompanyResponse(row, { contacts: 0, deals: null });
    expect(JSON.stringify(res)).not.toMatch(/"id":5|ownerId|createdById/);
    expect(res.owner).toEqual({ id: row.ownerUuid, name: 'Asha' });
    expect(res.createdBy).toBeNull();
    // the company's own property values travel as customFields (the `data` column is not a wire name)
    expect(res.customFields).toEqual({ tier: 'gold' });
    expect(res).not.toHaveProperty('data');
  });
});

describe('companyScopeCondition (D-02)', () => {
  it('all adds nothing; own and team without a person match nothing', () => {
    expect(companyScopeCondition(1, 'all', 7)).toBeUndefined();
    expect(companyScopeCondition(1, 'own', null)).toBeDefined();
    expect(companyScopeCondition(1, 'team', null)).toBeDefined();
    expect(companyScopeCondition(1, 'own', 7)).toBeDefined();
  });
});

describe('the company contracts (TW-CTP-002, 003, 005)', () => {
  it('create: a name is required; blanks are cleared to null; unknown keys are dropped', () => {
    expect(createCompanySchema.safeParse({}).success).toBe(false);
    expect(createCompanySchema.safeParse({ name: '   ' }).success).toBe(false);
    const ok = createCompanySchema.parse({
      name: '  Acme  ',
      email: '',
      phone: ' 123 ',
      website: 'acme.test',
      industry: '',
      extra: 'ignored',
    });
    expect(ok).toEqual({
      name: 'Acme',
      email: null,
      phone: '123',
      website: 'acme.test',
      industry: null,
    });
  });

  it("create: the length limits are Reference's (191 name, 32 phone, 100 industry, 40 size, 500 address, 2000 notes)", () => {
    const over = (field: string, n: number) =>
      createCompanySchema.safeParse({ name: 'A', [field]: 'x'.repeat(n + 1) }).success;
    expect(createCompanySchema.safeParse({ name: 'x'.repeat(191) }).success).toBe(true);
    expect(createCompanySchema.safeParse({ name: 'x'.repeat(192) }).success).toBe(false);
    expect(over('phone', 32)).toBe(false);
    expect(over('industry', 100)).toBe(false);
    expect(over('sizeRange', 40)).toBe(false);
    expect(over('address', 500)).toBe(false);
    expect(over('notes', 2000)).toBe(false);
    expect(over('website', 191)).toBe(false);
  });

  it('create: the email must be an address; the website is free text (Reference does not check it)', () => {
    expect(createCompanySchema.safeParse({ name: 'A', email: 'not-an-email' }).success).toBe(false);
    expect(createCompanySchema.safeParse({ name: 'A', email: 'ops@acme.test' }).success).toBe(true);
    expect(createCompanySchema.safeParse({ name: 'A', website: 'not a url at all' }).success).toBe(
      true,
    );
  });

  it('update: the name cannot be cleared, absent keeps, null clears, rowVersion is required', () => {
    expect(updateCompanySchema.safeParse({ name: '', rowVersion: 1 }).success).toBe(false);
    expect(updateCompanySchema.safeParse({ name: null, rowVersion: 1 }).success).toBe(false);
    expect(updateCompanySchema.safeParse({ phone: null }).success).toBe(false);
    const keep = updateCompanySchema.parse({ rowVersion: 2 });
    expect('phone' in keep && keep.phone !== undefined).toBe(false);
    expect(updateCompanySchema.parse({ phone: null, ownerId: null, rowVersion: 2 })).toMatchObject({
      phone: null,
      ownerId: null,
    });
  });

  it('list: sort defaults to newest first, limit is capped, owner and unassigned do not mix', () => {
    expect(listCompaniesQuerySchema.parse({}).sort).toBe('created');
    expect(listCompaniesQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(
      listCompaniesQuerySchema.safeParse({
        ownerId: '11111111-1111-4111-8111-111111111111',
        unassigned: 'true',
      }).success,
    ).toBe(false);
    expect(listCompaniesQuerySchema.parse({ hasOpenDeals: 'false' }).hasOpenDeals).toBe(false);
    expect(listCompaniesQuerySchema.parse({ hasOpenDeals: 'true' }).hasOpenDeals).toBe(true);
  });

  it('bulk and link bodies are bounded', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(bulkCompanyIdsSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(bulkCompanyIdsSchema.safeParse({ ids: Array(101).fill(id) }).success).toBe(false);
    expect(bulkCompanyIdsSchema.safeParse({ ids: [id] }).success).toBe(true);
    expect(linkCompanyContactsSchema.safeParse({ contactIds: ['nope'] }).success).toBe(false);
    expect(linkCompanyContactsSchema.safeParse({ contactIds: [id] }).success).toBe(true);
  });
});
