import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  contactConditions,
  contactLastActivity,
  whatsappSubscribedSql,
  whereOf,
  type ResolvedContactFilter,
} from '../../../src/modules/crm/contacts/contact-conditions';
import { compileRules, emptyRuleContext } from '../../../src/modules/crm/segments/segment-compiler';
import { toFieldResponse } from '../../../src/modules/crm/fields/fields.mapper';
import type { FieldRow } from '../../../src/modules/crm/fields/fields.repository';

const dialect = new PgDialect();
const render = (q: SQL) => dialect.sqlToQuery(q);
const base: ResolvedContactFilter = { includeArchived: false, tagMode: 'any' };
const where = (f: Partial<ResolvedContactFilter>) =>
  render(whereOf(contactConditions(7, { ...base, ...f }, undefined)));

describe('the last activity of a contact', () => {
  it('is the later of the stamp and the latest message of its conversations', () => {
    const { sql } = render(contactLastActivity);
    expect(sql).toContain('GREATEST');
    expect(sql).toContain('"contacts"."last_activity_at"');
    expect(sql).toMatch(/max\(cv\.last_message_at\) FROM conversations cv/);
    expect(sql).toContain('cv.contact_id = "contacts"."id"');
  });

  it('is what the date window filter reads (a migrated contact has conversations but no stamp)', () => {
    const { sql } = where({ lastActivityFrom: '2026-01-01' });
    expect(sql).toContain('conversations cv');
    expect(sql).not.toMatch(/"contacts"\."last_activity_at" >=/);
  });

  it('is what the segment rules read, so "never contacted" means no stamp and no conversation message', () => {
    const rules = {
      type: 'group',
      combinator: 'and',
      children: [{ type: 'condition', field: 'lastActivityAt', operator: 'is_empty' }],
    } as never;
    const { sql } = render(compileRules(7, rules, emptyRuleContext()).where);
    expect(sql).toContain('GREATEST');
    expect(sql).toContain('conversations cv');
  });
});

describe('subscribed, as the list column says it', () => {
  it('needs the WhatsApp label "subscribed" and no opt-out', () => {
    const { sql } = render(whatsappSubscribedSql);
    expect(sql).toContain('whatsapp_subscription_status');
    expect(sql).toContain("= 'subscribed'");
    expect(sql).toMatch(/NOT "contacts"\."is_unsubscribed"/);
  });

  it('subscribed=true keeps only those, subscribed=false everyone else', () => {
    expect(where({ subscribed: true }).sql).toContain("= 'subscribed'");
    expect(where({ subscribed: false }).sql).toMatch(/NOT \(lower\(btrim/);
  });

  it('is not added when the filter does not ask for it', () => {
    expect(where({}).sql).not.toContain('whatsapp_subscription_status');
  });

  it('leaves the opted-out filter as it was', () => {
    expect(where({ unsubscribed: true }).sql).toContain('"contacts"."is_unsubscribed" = $');
  });
});

describe('a field in a list', () => {
  const row = {
    id: 1,
    uuid: '11111111-1111-4111-8111-111111111111',
    moduleKey: 'contacts',
    sectionId: null,
    sectionUuid: null,
    key: 'city',
    label: 'City',
    fieldType: 'select',
    isRequired: false,
    isHidden: false,
    isReadOnly: false,
    isMasked: false,
    isUnique: false,
    isQuickCreate: false,
    isGlobalSearch: false,
    isSystem: false,
    isActive: true,
    position: 0,
    config: {},
    replacesFieldId: null,
    rowVersion: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  } satisfies FieldRow;

  it('says how many options it has even when it leaves them out', () => {
    const r = toFieldResponse(row, undefined, 48_000);
    expect(r.options).toBeUndefined();
    expect(r.optionCount).toBe(48_000);
  });

  it('carries no count for a type that has no options', () => {
    expect(toFieldResponse({ ...row, fieldType: 'text' }).optionCount).toBeUndefined();
  });
});
