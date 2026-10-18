import { describe, expect, it } from 'vitest';
import type { ContactRow } from '../api/schemas';
import {
  attributeChips,
  avatarTone,
  AVATAR_TONES,
  composeName,
  contactToForm,
  customFieldsFromForm,
  displayName,
  EMPTY_FORM,
  formatPhone,
  initials,
  isOptedOut,
  titleCaseKey,
  toCreatePayload,
  toUpdatePayload,
  validateForm,
} from './contact-model';

function row(over: Partial<ContactRow> = {}): ContactRow {
  return {
    id: '294dca7c-5806-4548-9035-dcca9befc7b1',
    displayId: null,
    name: 'Aarav Sharma',
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    companyId: null,
    ownerId: null,
    lifecycleState: 'active',
    lifecycleStage: 'new',
    lifecycleStageDate: null,
    previousLifecycleStage: null,
    previousLifecycleStageDate: null,
    status: null,
    lostReason: null,
    otherLostReason: null,
    wonAt: null,
    lostAt: null,
    leadScore: null,
    leadScoreSource: null,
    leadScoreReasons: null,
    leadScoredAt: null,
    uncontactedSince: null,
    leadScoreModel: null,
    source: null,
    isUnsubscribed: false,
    whatsappSubscriptionStatus: null,
    smsSubscriptionStatus: null,
    emailSubscriptionStatus: null,
    emailConfirmed: false,
    faxNumber: null,
    dateOfBirth: null,
    isMinor: false,
    lastActivityAt: null,
    customFields: {},
    isArchived: false,
    timezone: null,
    timezoneSource: null,
    rowVersion: 3,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...over,
  };
}

describe('composeName (TW-CON-012)', () => {
  it('joins the non-empty parts with single spaces', () => {
    expect(composeName({ firstName: 'Aarav', middleName: 'K', lastName: 'Sharma' })).toBe(
      'Aarav K Sharma',
    );
    expect(composeName({ firstName: ' Priya ', middleName: '', lastName: ' Patel' })).toBe(
      'Priya Patel',
    );
  });

  it('keeps the title out of the display name (Reference turned every contact into "Mr ...")', () => {
    expect(composeName({ firstName: 'Priya' })).toBe('Priya');
  });

  it('does not repeat a surname that is already the end of the first name', () => {
    expect(composeName({ firstName: 'Aarav Sharma', lastName: 'Sharma' })).toBe('Aarav Sharma');
  });
});

describe('display helpers', () => {
  it('falls back from name to first/last, then phone, then email', () => {
    expect(
      displayName({
        name: 'ACME Support',
        firstName: null,
        lastName: null,
        phone: null,
        email: null,
      }),
    ).toBe('ACME Support');
    expect(
      displayName({ name: null, firstName: 'A', lastName: 'B', phone: '+1', email: 'x@y.z' }),
    ).toBe('A B');
    expect(
      displayName({
        name: null,
        firstName: null,
        lastName: null,
        phone: '+919876543210',
        email: null,
      }),
    ).toBe('+919876543210');
    expect(
      displayName({ name: null, firstName: null, lastName: null, phone: null, email: 'x@y.z' }),
    ).toBe('x@y.z');
  });

  it('builds avatar initials from the first two words', () => {
    expect(initials('aarav sharma')).toBe('AS');
    expect(initials('Madonna')).toBe('MA');
    expect(initials('   ')).toBe('?');
  });

  it('keeps a contact on the same avatar tint', () => {
    const id = '294dca7c-5806-4548-9035-dcca9befc7b1';
    expect(avatarTone(id)).toBe(avatarTone(id));
    expect(AVATAR_TONES).toContain(avatarTone(id));
  });

  it('formats a valid E.164 number internationally and leaves anything else alone', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
    expect(formatPhone('not a number')).toBe('not a number');
    expect(formatPhone(null)).toBe('');
  });

  it('title-cases keys', () => {
    expect(titleCaseKey('order_id')).toBe('Order Id');
    expect(titleCaseKey('tracking-url')).toBe('Tracking Url');
  });
});

describe('attributeChips (TW-CON-008 rule 1)', () => {
  it('shows only non-empty scalar values and never the keys the form owns', () => {
    const chips = attributeChips({
      status: 'vip',
      source: 'web',
      order_id: 'A12',
      city: '',
      nested: { a: 1 },
    });
    expect(chips.map((c) => c.full)).toEqual(['Order Id: A12']);
  });

  it('caps at four chips and truncates long values to 18 characters with the full text on hover', () => {
    const chips = attributeChips({
      a: '1',
      b: '2',
      c: '3',
      d: '4',
      e: '5',
      f: '6',
      long: 'x'.repeat(30),
    });
    expect(chips).toHaveLength(4);
    const [long] = attributeChips({ long: 'x'.repeat(30) });
    expect(long!.text).toBe(`${'x'.repeat(18)}…`);
    expect(long!.full).toBe(`Long: ${'x'.repeat(30)}`);
  });

  it('uses the workspace attribute name when there is one', () => {
    const [chip] = attributeChips({ order_id: 'A12' }, new Map([['order_id', 'Order number']]));
    expect(chip!.label).toBe('Order number');
  });
});

describe('contact form <-> API mapping', () => {
  it('opens a contact that has only a display name with it as the first name', () => {
    const f = contactToForm(row({ name: 'Walk In', firstName: null, lastName: null }));
    expect(f.firstName).toBe('Walk In');
    expect(f.lastName).toBe('');
  });

  it('reads the reserved extras and attribute values from customFields', () => {
    const f = contactToForm(
      row({
        firstName: 'A',
        customFields: {
          title: 'Dr',
          middle_name: 'K',
          language: 'English',
          memo: 'hi',
          order_id: 'A12',
          source: 'web',
        },
      }),
    );
    expect(f).toMatchObject({
      title: 'Dr',
      middleName: 'K',
      language: 'English',
      memo: 'hi',
      source: 'web',
    });
    expect(f.attributes).toEqual({ order_id: 'A12' });
  });

  it('reads the opt-out switch from the consent flag', () => {
    expect(contactToForm(row({ isUnsubscribed: true })).optedOut).toBe(true);
    expect(isOptedOut(row({ isUnsubscribed: false }))).toBe(false);
  });

  it('reads the groups from the expanded refs and the source from its column', () => {
    const f = contactToForm(
      row({
        groups: [{ id: 'g1', name: 'VIP', color: null }],
        source: 'import',
        customFields: { source: 'old' },
      }),
    );
    expect(f.groupIds).toEqual(['g1']);
    expect(f.source).toBe('import');
  });

  it('creates with only the values that were filled in, and no forced title', () => {
    const payload = toCreatePayload(
      {
        ...EMPTY_FORM,
        firstName: 'Priya',
        phone: '+919876543210',
        attributes: { order_id: 'A12', empty: '' },
      },
      ['order_id', 'empty'],
    );
    expect(payload).toEqual({
      name: 'Priya',
      firstName: 'Priya',
      phone: '+919876543210',
      ownerId: null,
      customFields: { order_id: 'A12' },
    });
    expect(payload).not.toHaveProperty('title');
  });

  it('includes the opt-out on create only when it is on', () => {
    expect(toCreatePayload({ ...EMPTY_FORM, firstName: 'A', optedOut: true }, [])).toMatchObject({
      isUnsubscribed: true,
    });
    expect(toCreatePayload({ ...EMPTY_FORM, firstName: 'A' }, [])).not.toHaveProperty(
      'isUnsubscribed',
    );
  });

  it('clears a value with null on update (Reference could never clear a field)', () => {
    const payload = toUpdatePayload(
      { ...EMPTY_FORM, firstName: 'A', email: '', language: '', attributes: { order_id: '' } },
      ['order_id'],
      3,
      false,
      { language: 'English', order_id: 'A12' },
    );
    expect(payload.email).toBeNull();
    expect(payload.lastName).toBeNull();
    expect(payload.customFields).toEqual({ language: null, order_id: null });
    expect(payload.rowVersion).toBe(3);
  });

  it('does not write a null for a custom value that was empty and still is', () => {
    const payload = toUpdatePayload({ ...EMPTY_FORM, firstName: 'A' }, ['order_id'], 3, false, {});
    expect(payload.customFields).toEqual({});
  });

  it('touches consent only when the switch changed', () => {
    const same = toUpdatePayload({ ...EMPTY_FORM, firstName: 'A' }, [], 1, false);
    expect(same).not.toHaveProperty('isUnsubscribed');
    const out = toUpdatePayload({ ...EMPTY_FORM, firstName: 'A', optedOut: true }, [], 1, false);
    expect(out.isUnsubscribed).toBe(true);
    const back = toUpdatePayload({ ...EMPTY_FORM, firstName: 'A', optedOut: false }, [], 1, true);
    expect(back.isUnsubscribed).toBe(false);
  });

  it('the company: opens from the contact, goes out on create only when chosen, and on edit only when it changed (null clears)', () => {
    const co = '5f1c1e0e-2f4b-4a58-9c1e-1d7a0f0f0001';
    expect(contactToForm(row({ companyId: co })).companyId).toBe(co);
    expect(contactToForm(row({ companyId: null })).companyId).toBe('');
    expect(toCreatePayload({ ...EMPTY_FORM, firstName: 'A' }, [])).not.toHaveProperty('companyId');
    expect(toCreatePayload({ ...EMPTY_FORM, firstName: 'A', companyId: co }, [])).toMatchObject({
      companyId: co,
    });
    const base = { ...EMPTY_FORM, firstName: 'A' };
    expect(
      toUpdatePayload(
        { ...base, companyId: co },
        [],
        1,
        false,
        {},
        undefined,
        undefined,
        null,
        null,
        co,
      ),
    ).not.toHaveProperty('companyId');
    expect(toUpdatePayload({ ...base, companyId: '' }, [], 1, false)).not.toHaveProperty(
      'companyId',
    );
    expect(toUpdatePayload({ ...base, companyId: co }, [], 1, false)).toMatchObject({
      companyId: co,
    });
    expect(
      toUpdatePayload(
        { ...base, companyId: '' },
        [],
        1,
        false,
        {},
        undefined,
        undefined,
        null,
        null,
        co,
      ),
    ).toMatchObject({ companyId: null });
  });

  it('writes the group-independent extras under the reserved keys', () => {
    const cf = customFieldsFromForm({ ...EMPTY_FORM, title: 'Dr', memo: ' note ' }, []);
    expect(cf).toMatchObject({ title: 'Dr', memo: 'note', middle_name: null });
  });
});

describe('validateForm', () => {
  it('requires a first name', () => {
    expect(validateForm({ ...EMPTY_FORM, phone: '+919876543210' }, false).firstName).toBe(
      'firstNameRequired',
    );
  });

  it('requires a phone or an email, like the API', () => {
    expect(validateForm({ ...EMPTY_FORM, firstName: 'A' }, false).phone).toBe(
      'contactPointRequired',
    );
    expect(validateForm({ ...EMPTY_FORM, firstName: 'A', email: 'a@b.co' }, false)).toEqual({});
    expect(validateForm({ ...EMPTY_FORM, firstName: 'A', phone: '+919876543210' }, false)).toEqual(
      {},
    );
  });

  it('flags a bad email and a number the phone field rejected', () => {
    expect(validateForm({ ...EMPTY_FORM, firstName: 'A', email: 'nope' }, false).email).toBe(
      'emailInvalid',
    );
    expect(validateForm({ ...EMPTY_FORM, firstName: 'A' }, true).phone).toBe('phoneInvalid');
  });
});

describe('typed contact properties', () => {
  const types = new Map<
    string,
    { fieldType: 'integer' | 'multiselect' | 'checkbox' | 'date' | 'text' }
  >([
    ['seats', { fieldType: 'integer' }],
    ['interests', { fieldType: 'multiselect' }],
    ['vip', { fieldType: 'checkbox' }],
    ['renewal', { fieldType: 'date' }],
    ['city', { fieldType: 'text' }],
  ]);
  const keys = [...types.keys()];

  it('reads lists back into the form and keeps scalars as text', () => {
    const f = contactToForm(
      row({ customFields: { seats: 4, interests: ['a', 'b'], vip: true, nested: { x: 1 } } }),
    );
    expect(f.attributes).toEqual({ seats: '4', interests: ['a', 'b'], vip: 'true' });
  });

  it('writes each value as its type: numbers as numbers, lists as lists, checkboxes as booleans', () => {
    const payload = toCreatePayload(
      {
        ...EMPTY_FORM,
        firstName: 'A',
        attributes: {
          seats: '4',
          interests: ['a', 'b'],
          vip: 'true',
          renewal: '2026-12-01',
          city: ' Pune ',
        },
      },
      keys,
      types,
    );
    expect(payload.customFields).toMatchObject({
      seats: 4,
      interests: ['a', 'b'],
      vip: true,
      renewal: '2026-12-01',
      city: 'Pune',
    });
  });

  it('leaves an empty value out on create and clears it with null on update', () => {
    const empty = {
      ...EMPTY_FORM,
      firstName: 'A',
      attributes: { seats: '', interests: [], city: '' },
    };
    const created = toCreatePayload(empty, keys, types).customFields;
    expect(created).not.toHaveProperty('seats');
    expect(created).not.toHaveProperty('interests');
    const updated = toUpdatePayload(empty, keys, 2, false, { seats: 4, interests: ['a'] }, types);
    expect(updated.customFields).toMatchObject({ seats: null, interests: null });
    expect(updated.customFields).not.toHaveProperty('city');
  });

  it('does not write an unticked checkbox on a contact that never had a value', () => {
    const v = { ...EMPTY_FORM, firstName: 'A', attributes: { vip: 'false' } };
    expect(toUpdatePayload(v, keys, 1, false, {}, types).customFields).not.toHaveProperty('vip');
    // but unticking one that was ticked is a change
    expect(toUpdatePayload(v, keys, 1, false, { vip: true }, types).customFields).toMatchObject({
      vip: false,
    });
  });
});

describe('lead score in the form (AI lead scoring)', () => {
  const base = { ...EMPTY_FORM, firstName: 'Aarav', email: 'a@x.co' };
  it('opens with the score the contact has, or an empty box', () => {
    expect(contactToForm(row({ leadScore: 72, leadScoreSource: 'ai' })).leadScore).toBe('72');
    expect(contactToForm(row()).leadScore).toBe('');
  });
  it('saving an unrelated field leaves an AI score alone (it must not turn into a manual one)', () => {
    const v = contactToForm(row({ leadScore: 72, leadScoreSource: 'ai' }));
    expect(toUpdatePayload(v, [], 3, false, {}, undefined, undefined, 72)).not.toHaveProperty(
      'leadScore',
    );
  });
  it('sends a typed score, and null when the box is cleared', () => {
    expect(
      toUpdatePayload({ ...base, leadScore: '80' }, [], 3, false, {}, undefined, undefined, 72),
    ).toMatchObject({ leadScore: 80 });
    expect(
      toUpdatePayload({ ...base, leadScore: '' }, [], 3, false, {}, undefined, undefined, 72),
    ).toMatchObject({ leadScore: null });
    expect(toUpdatePayload({ ...base, leadScore: '' }, [], 3, false)).not.toHaveProperty(
      'leadScore',
    );
  });
  it('sends a score typed on a new contact only when there is one', () => {
    expect(toCreatePayload({ ...base, leadScore: '35' }, [])).toMatchObject({ leadScore: 35 });
    expect(toCreatePayload(base, [])).not.toHaveProperty('leadScore');
  });
});

describe('owner in the form', () => {
  const ASHA = '11111111-1111-4111-8111-111111111111';
  const RAVI = '22222222-2222-4222-8222-222222222222';
  const base = { ...EMPTY_FORM, firstName: 'A' };
  const update = (ownerId: string, previous: string | null) =>
    toUpdatePayload({ ...base, ownerId }, [], 1, false, {}, undefined, undefined, null, previous);

  it('fills the edit form from the contact, unassigned as an empty string', () => {
    expect(contactToForm(row({ ownerId: ASHA })).ownerId).toBe(ASHA);
    expect(contactToForm(row({ ownerId: null })).ownerId).toBe('');
  });

  it('always says who owns a new contact: the picked person, or null for nobody (omitting it would mean the creator)', () => {
    expect(toCreatePayload({ ...base, ownerId: ASHA }, [])).toMatchObject({ ownerId: ASHA });
    expect(toCreatePayload({ ...base, ownerId: '' }, [])).toMatchObject({ ownerId: null });
  });

  it('sends the owner on an update only when the form changed it, so an unrelated save never re-assigns', () => {
    expect(update(ASHA, ASHA)).not.toHaveProperty('ownerId');
    expect(update('', null)).not.toHaveProperty('ownerId');
    expect(update(RAVI, ASHA)).toMatchObject({ ownerId: RAVI });
    expect(update('', ASHA)).toMatchObject({ ownerId: null });
  });
});
