import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { PERSONAL_DATA_REGISTRY, registeredSpecs } from '../../../src/modules/privacy/registry';
import { linkKinds, rowsOf } from '../../../src/modules/privacy/registry/sql';
import type { ResolvedSubject } from '../../../src/modules/privacy/registry/types';

/**
 * The declarations of the derived copies (revenue export files, company briefs) and the SQL they generate, without a database. The
 * behaviour on a real Postgres is `test/integration/privacy/derived-copies-erasure.spec.ts`.
 */
const dialect = new PgDialect();
const render = (q: ReturnType<typeof rowsOf>) => dialect.sqlToQuery(q);

const spec = (table: string) => {
  const hit = registeredSpecs().find((p) => p.spec.table === table);
  if (!hit) throw new Error(`${table} is not registered`);
  return hit;
};

const empty: ResolvedSubject = {
  orgId: 7,
  contactIds: [],
  contactUuids: [],
  userIds: [],
  userEmails: [],
  leadIds: [],
  conversationIds: [],
  conversationUuids: [],
  phoneDigits: [],
  emails: [],
  peerKeys: [],
};
const contact: ResolvedSubject = { ...empty, contactIds: [11], emails: ['rita@buyer.example'] };
const staff: ResolvedSubject = { ...empty, userIds: [3], userEmails: ['alice@staff.example'] };

describe('derived copies in the personal-data registry', () => {
  it('registers revenue_report_exports and company_briefs once, as deleted derived copies in the core tier', () => {
    for (const table of ['revenue_report_exports', 'company_briefs']) {
      const { spec: s } = spec(table);
      expect(s.disposition).toBe('delete');
      expect(s.tier).toBe('core');
      expect(s.audited).toBe(true);
      expect(registeredSpecs().filter((p) => p.spec.table === table)).toHaveLength(1);
    }
    const holders = PERSONAL_DATA_REGISTRY.map((h) => h.key);
    expect(holders).toContain('revenue.exports');
    expect(holders).toContain('companies.briefs');
  });

  it('states the 7-day rule, that the file is in the row and that the sweep is daily, in the registry entry', () => {
    const { spec: s } = spec('revenue_report_exports');
    expect(s.retention).toMatch(/7 days/);
    expect(s.retention).toMatch(/file_gz/);
    expect(s.retention).toMatch(/daily sweep/);
    expect(s.retention).toMatch(/Not a record of truth|not a record of truth/i);
    expect(s.pii).toEqual(expect.arrayContaining(['emailed_to', 'file_gz']));
    expect(s.storage ?? []).toEqual([]);
    expect(s.exportOmit).toContain('file_gz');
  });

  it('treats the brief text as personal and says why', () => {
    const { spec: s } = spec('company_briefs');
    expect(s.pii).toEqual(['content']);
    expect(s.categories).toContain('ai_inference');
    expect(s.retention).toMatch(/regenerable/i);
  });

  it('links revenue exports to the staff member by id and by address, and to a buyer through invoices and payments', () => {
    const { spec: s } = spec('revenue_report_exports');
    expect(linkKinds(s)).toEqual(new Set(['user', 'user_email', 'custom']));
    const forContact = render(rowsOf(s, contact));
    expect(forContact.sql).toContain('FROM invoices');
    expect(forContact.sql).toContain('FROM payments');
    expect(forContact.sql).toContain(`status IN ('queued', 'running', 'ready')`);
    // a buyer purges unexpired exports only: an expired or failed row holds no file
    expect(forContact.sql).not.toContain(`'expired'`);
    const forStaff = render(rowsOf(s, staff));
    expect(forStaff.sql).toContain('"requested_by"');
    expect(forStaff.sql).toContain('lower("emailed_to"::text)');
  });

  it("a contact's own export never reaches other members' rows; a staff member's export does reach theirs", () => {
    for (const table of ['revenue_report_exports', 'company_briefs']) {
      const { spec: s } = spec(table);
      const asked = render(rowsOf(s, contact, 'export'));
      expect(asked.sql).not.toContain('FROM invoices');
      expect(asked.sql).not.toContain('FROM contacts');
      expect(asked.sql).toContain('FALSE');
      const own = render(rowsOf(s, staff, 'export'));
      expect(own.sql).not.toContain('FALSE)');
      expect(own.params).toContain('{3}');
    }
  });

  it('matches nothing for a subject that is not a staff member, a buyer or linked to a company', () => {
    for (const table of ['revenue_report_exports', 'company_briefs']) {
      const { spec: s } = spec(table);
      const q = render(rowsOf(s, empty));
      expect(q.sql).toContain('FALSE');
      expect(q.params).not.toContain('{}');
    }
  });

  it("finds a contact's briefs through the company the contact is linked to", () => {
    const { spec: s } = spec('company_briefs');
    const q = render(rowsOf(s, contact));
    expect(q.sql).toContain('FROM contacts');
    expect(q.sql).toContain('company_id');
    expect(q.params).toContain('{11}');
  });
});
