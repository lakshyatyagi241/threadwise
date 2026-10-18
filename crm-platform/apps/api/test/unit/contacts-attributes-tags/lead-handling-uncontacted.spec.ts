import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  UNCONTACTED_DEFAULTS,
  bulkSetUncontactedSchema,
  contactFilterToRules,
  listContactsQuerySchema,
  mergeUncontactedSettings,
  touchContactSchema,
  updateUncontactedSettingsSchema,
} from '@crm/contracts';
import { contactConditions } from '../../../src/modules/crm/contacts/contact-conditions';
import {
  callReachedContact,
  clearsOn,
  createMethodOfActor,
  marksNew,
} from '../../../src/modules/crm/lead-handling/lead-handling-rules';
import { settingsDelta } from '../../../src/modules/crm/lead-handling/lead-handling-settings.service';

describe('uncontacted settings: defaults change nothing', () => {
  it('never marks a contact on its own, and keeps the owner on a reassign', () => {
    expect(UNCONTACTED_DEFAULTS.markNew).toEqual({
      manual: false,
      import: false,
      leadSource: false,
    });
    expect(UNCONTACTED_DEFAULTS.onReassign).toBe('keep');
    for (const m of ['manual', 'import', 'lead_source'] as const) {
      expect(marksNew(UNCONTACTED_DEFAULTS, m)).toBe(false);
    }
  });

  it('a section that was never saved reads as the defaults, and so does garbage', () => {
    expect(mergeUncontactedSettings(undefined)).toEqual(UNCONTACTED_DEFAULTS);
    expect(mergeUncontactedSettings(null)).toEqual(UNCONTACTED_DEFAULTS);
    expect(mergeUncontactedSettings('x')).toEqual(UNCONTACTED_DEFAULTS);
    expect(mergeUncontactedSettings({ clearOn: 5, markNew: [], onReassign: 'delete' })).toEqual(
      UNCONTACTED_DEFAULTS,
    );
  });

  it('merges a stored document field by field, so a knob added later needs no migration', () => {
    const merged = mergeUncontactedSettings({
      clearOn: { message: false },
      markNew: { leadSource: true },
      onReassign: 'mark',
    });
    expect(merged.clearOn).toEqual({
      contactButton: true,
      message: false,
      automation: true,
      activity: true,
    });
    expect(merged.markNew).toEqual({ manual: false, import: false, leadSource: true });
    expect(merged.onReassign).toBe('mark');
  });
});

describe('which action clears the marker, which creation marks it', () => {
  const only = (key: 'contactButton' | 'message' | 'automation' | 'activity') => ({
    ...UNCONTACTED_DEFAULTS,
    clearOn: {
      contactButton: false,
      message: false,
      automation: false,
      activity: false,
      [key]: true,
    },
  });

  it.each([
    ['contact_button', 'contactButton'],
    ['message', 'message'],
    ['automation', 'automation'],
    ['activity', 'activity'],
  ] as const)('%s is governed by its own toggle only', (source, key) => {
    expect(clearsOn(only(key), source)).toBe(true);
    for (const other of ['contact_button', 'message', 'automation', 'activity'] as const) {
      if (other !== source) expect(clearsOn(only(key), other)).toBe(false);
    }
  });

  it('maps who created the contact to a method: a person is manual, a key or a partner is a lead source, a worker is none', () => {
    expect(createMethodOfActor('user')).toBe('manual');
    expect(createMethodOfActor('api_key')).toBe('lead_source');
    expect(createMethodOfActor('partner_agent')).toBe('lead_source');
    expect(createMethodOfActor('system')).toBeNull();
    expect(createMethodOfActor('bot')).toBeNull();
  });
});

describe('a call that reaches the contact', () => {
  const call = (direction: string, outcome: string, handler: number | null = 7) => ({
    handlerUserId: handler,
    direction,
    outcome,
  });
  it('counts a placed call, even unanswered, and an answered inbound call', () => {
    expect(callReachedContact(call('outbound', 'no_answer'))).toBe(true);
    expect(callReachedContact(call('outbound', 'connected'))).toBe(true);
    expect(callReachedContact(call('inbound', 'connected'))).toBe(true);
  });
  it('does not count a missed inbound call, an unhandled call, a failed call or a wrong number', () => {
    expect(callReachedContact(call('inbound', 'no_answer'))).toBe(false);
    expect(callReachedContact(call('outbound', 'connected', null))).toBe(false);
    expect(callReachedContact(call('outbound', 'failed'))).toBe(false);
    expect(callReachedContact(call('outbound', 'wrong_number'))).toBe(false);
  });
});

describe('settings audit delta', () => {
  it('lists only the leaves that changed', () => {
    const next = { ...UNCONTACTED_DEFAULTS, onReassign: 'mark' as const };
    expect(settingsDelta(UNCONTACTED_DEFAULTS, next)).toEqual({
      onReassign: { old: 'keep', new: 'mark' },
    });
    expect(settingsDelta(UNCONTACTED_DEFAULTS, UNCONTACTED_DEFAULTS)).toEqual({});
  });
});

describe('contracts', () => {
  it('a save needs every toggle; the first save has no rowVersion', () => {
    expect(updateUncontactedSettingsSchema.safeParse(UNCONTACTED_DEFAULTS).success).toBe(true);
    expect(
      updateUncontactedSettingsSchema.safeParse({ ...UNCONTACTED_DEFAULTS, rowVersion: 2 }).success,
    ).toBe(true);
    expect(updateUncontactedSettingsSchema.safeParse({ clearOn: {} }).success).toBe(false);
    expect(
      updateUncontactedSettingsSchema.safeParse({ ...UNCONTACTED_DEFAULTS, onReassign: 'x' })
        .success,
    ).toBe(false);
  });

  it('the touch body names one of the four buttons', () => {
    for (const channel of ['call', 'sms', 'email', 'whatsapp']) {
      expect(touchContactSchema.safeParse({ channel }).success).toBe(true);
    }
    expect(touchContactSchema.safeParse({ channel: 'fax' }).success).toBe(false);
  });

  it('the bulk body takes ids or a filter, not both and not neither', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(bulkSetUncontactedSchema.safeParse({ ids: [id], uncontacted: true }).success).toBe(true);
    expect(
      bulkSetUncontactedSchema.safeParse({ filter: { uncontacted: true }, uncontacted: false })
        .success,
    ).toBe(true);
    expect(bulkSetUncontactedSchema.safeParse({ uncontacted: true }).success).toBe(false);
    expect(
      bulkSetUncontactedSchema.safeParse({ ids: [id], filter: {}, uncontacted: true }).success,
    ).toBe(false);
  });
});

describe('the uncontacted filter', () => {
  const dialect = new PgDialect();
  const sqlOf = (uncontacted: boolean) => {
    const conditions = contactConditions(
      1,
      { includeArchived: false, tagMode: 'any', uncontacted },
      undefined,
    );
    return conditions.map((c) => dialect.sqlToQuery(c).sql).join(' AND ');
  };

  it('reads the marker column in both directions', () => {
    expect(sqlOf(true)).toContain('"uncontacted_since" IS NOT NULL');
    expect(sqlOf(false)).toContain('"uncontacted_since" IS NULL');
  });

  it('comes in from the query string as a boolean, and an absent filter adds nothing', () => {
    expect(listContactsQuerySchema.parse({ uncontacted: 'true' }).uncontacted).toBe(true);
    expect(listContactsQuerySchema.parse({}).uncontacted).toBeUndefined();
    const conditions = contactConditions(1, { includeArchived: false, tagMode: 'any' }, undefined);
    expect(conditions.map((c) => dialect.sqlToQuery(c).sql).join(' ')).not.toContain('uncontacted');
  });

  it('a saved filter becomes the same segment rule', () => {
    const rules = JSON.stringify(contactFilterToRules({ uncontacted: true, tagMode: 'any' }));
    expect(rules).toContain('"uncontacted"');
    expect(rules).toContain('is_true');
  });
});
