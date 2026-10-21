import type { FieldResponse } from '@crm/contracts';
import { i18n } from '@/lib/i18n';
import {
  bare,
  birthdayField,
  budgetField,
  cityField,
  discountField,
  fieldDefinitions,
  gstField,
  interestsMulti,
  landlineField,
  linkField,
  nextVisitField,
  notesField,
  planSelect,
  priya,
  profile,
  ratingField,
  retiredField,
  scoreFormula,
  secretField,
  statusOptions,
  stageLost,
  stageNew,
  stageQualified,
  statusHot,
  taxIdField,
  visitsField,
  vipField,
  websiteField,
  workEmailField,
  field,
  reasonPrice,
} from '@/test/contact-properties-fixtures';
import { formatDate, formatMoment } from './contact-display';
import {
  EMPTY_DRAFT,
  MASKED,
  NO_VALUE,
  OTHER_REASON,
  buildRows,
  columnTextOf,
  currentValueOf,
  draftOf,
  editorKindOf,
  firstStatusOf,
  formatPropertyValue,
  groupRows,
  initialDraftOf,
  isEmptyValue,
  keyboardFor,
  lifecycleChanges,
  lockReasonOf,
  optionsOfGroup,
  parseDraft,
  parseEdit,
  parseStandard,
  sameValue,
  stageChoices,
  statusChoices,
  searchRows,
  standardText,
  statusFitsStage,
  statusScope,
  statusesForStage,
  titleCaseKey,
  updateBodyFor,
  visibleRows,
  type Draft,
} from './property-values';

const fmt = { locale: 'en', yes: 'Yes', no: 'No' };
const draft = (over: Partial<Draft>): Draft => ({ ...EMPTY_DRAFT, ...over });
const t = i18n.t.bind(i18n);

describe('isEmptyValue', () => {
  it('counts nothing, blank text and empty lists as empty, and false and zero as values', () => {
    expect([null, undefined, '', '   ', []].every(isEmptyValue)).toBe(true);
    expect([false, 0, 'x', ['a']].some(isEmptyValue)).toBe(false);
  });
});

describe('titleCaseKey', () => {
  it('turns a stored key into words', () => {
    expect(titleCaseKey('application_started')).toBe('Application Started');
    expect(titleCaseKey('on-hold')).toBe('On Hold');
  });
});

describe('formatPropertyValue', () => {
  it('shows nothing for an empty value, and dots for a masked one', () => {
    expect(formatPropertyValue(cityField, '', fmt)).toBeNull();
    expect(formatPropertyValue(cityField, null, fmt)).toBeNull();
    expect(formatPropertyValue(secretField, 'hunter2', fmt)).toBe(MASKED);
  });

  it('shows yes or no for a switch, whatever shape the value arrived in', () => {
    expect(formatPropertyValue(vipField, true, fmt)).toBe('Yes');
    expect(formatPropertyValue(vipField, false, fmt)).toBe('No');
    expect(formatPropertyValue(vipField, 'true', fmt)).toBe('Yes');
    expect(formatPropertyValue(vipField, 'maybe', fmt)).toBe('maybe');
  });

  it('formats a date as the calendar day it names and a moment in the language of the app', () => {
    expect(formatPropertyValue(birthdayField, '2026-10-12', fmt)).toBe(
      formatDate('2026-10-12T00:00:00', 'en'),
    );
    expect(formatPropertyValue(birthdayField, 'soon', fmt)).toBe('soon');
    expect(formatPropertyValue(nextVisitField, '2026-11-03T14:30', fmt)).toBe(
      formatMoment('2026-11-03T14:30', 'en'),
    );
  });

  it('formats numbers with the locale, a currency with its code, a percentage with its sign', () => {
    expect(formatPropertyValue(visitsField, 1234567, fmt)).toBe('1,234,567');
    expect(formatPropertyValue(budgetField, 150000, fmt)).toMatch(/150,000/);
    expect(formatPropertyValue(budgetField, 150000, fmt)).toContain('₹');
    expect(formatPropertyValue(discountField, '12.5', fmt)).toBe('12.5%');
    expect(formatPropertyValue(ratingField, 4, fmt)).toBe('4');
    // Not a number at all: shown as it was stored.
    expect(formatPropertyValue(visitsField, 'many', fmt)).toBe('many');
  });

  it('keeps a currency without a usable code, and a huge whole number, as plain text', () => {
    const noCode = { ...budgetField, config: {} };
    expect(formatPropertyValue(noCode, 2500.5, fmt)).toBe('2,500.5');
    const badCode = { ...budgetField, config: { code: 'ZZ' } };
    expect(formatPropertyValue(badCode, 7, fmt)).toBe('7');
    const big = field({ key: 'big', label: 'Big', fieldType: 'big_integer' });
    expect(formatPropertyValue(big, '9007199254740993', fmt)).toBe('9007199254740993');
    expect(formatPropertyValue(big, 5000, fmt)).toBe('5,000');
  });

  it('shows the label of an option, and the labels of several joined', () => {
    expect(formatPropertyValue(planSelect, 'pro', fmt)).toBe('Pro');
    expect(formatPropertyValue(planSelect, 'gone', fmt)).toBe('gone');
    expect(formatPropertyValue(interestsMulti, ['sports', 'travel'], fmt)).toBe('Sports, Travel');
    expect(formatPropertyValue(interestsMulti, 'music', fmt)).toBe('Music');
  });

  it('shows text, a link, an email and a phone as they are, and anything without a definition by its shape', () => {
    expect(formatPropertyValue(websiteField, 'https://example.test', fmt)).toBe(
      'https://example.test',
    );
    expect(formatPropertyValue(workEmailField, 'a@b.test', fmt)).toBe('a@b.test');
    expect(formatPropertyValue(landlineField, '020 1234', fmt)).toBe('020 1234');
    expect(formatPropertyValue(undefined, ['a', true], fmt)).toBe('a, Yes');
    expect(formatPropertyValue(undefined, { a: 1 }, fmt)).toBe('{"a":1}');
  });
});

describe('editors', () => {
  it('gives every property type an editor', () => {
    const kinds = {
      text: 'text',
      url: 'text',
      email: 'text',
      phone: 'text',
      timezone: 'text',
      long_text: 'longText',
      integer: 'integer',
      big_integer: 'integer',
      rating: 'integer',
      decimal: 'decimal',
      percentage: 'decimal',
      currency: 'decimal',
      boolean: 'boolean',
      checkbox: 'boolean',
      date: 'date',
      datetime: 'datetime',
      select: 'single',
      radio: 'single',
      multiselect: 'multi',
      lookup: 'unsupported',
      formula: 'unsupported',
    } as const;
    for (const [type, kind] of Object.entries(kinds)) {
      expect(editorKindOf(type as keyof typeof kinds)).toBe(kind);
    }
  });

  it('picks the keyboard that suits the type', () => {
    expect(keyboardFor('email')).toBe('email-address');
    expect(keyboardFor('url')).toBe('url');
    expect(keyboardFor('phone')).toBe('phone-pad');
    expect(keyboardFor('integer')).toBe('number-pad');
    expect(keyboardFor('currency')).toBe('decimal-pad');
    expect(keyboardFor('text')).toBe('default');
  });

  it('says why a property cannot be edited', () => {
    expect(lockReasonOf(taxIdField)).toBe('readonly');
    expect(lockReasonOf(scoreFormula)).toBe('readonly');
    expect(lockReasonOf(secretField)).toBe('readonly');
    expect(lockReasonOf({ ...cityField, isSystem: true })).toBe('readonly');
    expect(lockReasonOf(linkField)).toBe('unsupported');
    expect(lockReasonOf(cityField)).toBeNull();
  });
});

describe('draftOf', () => {
  it('spreads a stored value over the parts the editor shows', () => {
    expect(draftOf(cityField, 'Pune').text).toBe('Pune');
    expect(draftOf(visitsField, 3).text).toBe('3');
    expect(draftOf(cityField, null).text).toBe('');
    expect(draftOf(vipField, true).on).toBe(true);
    expect(draftOf(vipField, null).on).toBe(false);
    expect(draftOf(birthdayField, '2026-10-12T00:00:00Z').text).toBe('2026-10-12');
    expect(draftOf(birthdayField, null).text).toBe('');
    expect(draftOf(nextVisitField, '2026-11-03T14:30:00.000Z')).toMatchObject({
      text: '2026-11-03',
      time: '14:30',
    });
    expect(draftOf(nextVisitField, 'garbage').text).toBe('');
    expect(draftOf(planSelect, 'pro').picked).toEqual(['pro']);
    expect(draftOf(planSelect, null).picked).toEqual([]);
    expect(draftOf(interestsMulti, ['sports', 3]).picked).toEqual(['sports', '3']);
    expect(draftOf(interestsMulti, 'music').picked).toEqual(['music']);
    expect(draftOf(interestsMulti, '').picked).toEqual([]);
  });
});

describe('parseDraft', () => {
  const ok = (value: unknown) => ({ ok: true, value });
  const options = planSelect.options ?? [];

  it('clears on an empty draft, unless the property is required', () => {
    expect(parseDraft(cityField, draft({ text: '  ' }))).toEqual(ok(null));
    expect(parseDraft(gstField, draft({}))).toEqual({
      ok: false,
      error: 'required',
      params: { label: 'GST number' },
    });
    expect(parseDraft(birthdayField, draft({}))).toEqual(ok(null));
    expect(parseDraft(nextVisitField, draft({}))).toEqual(ok(null));
    expect(parseDraft(planSelect, draft({}), options)).toEqual(ok(null));
    expect(parseDraft({ ...planSelect, isRequired: true }, draft({}), options)).toMatchObject({
      error: 'required',
    });
  });

  it('keeps text, trimmed, and holds it to its length', () => {
    expect(parseDraft(cityField, draft({ text: ' Pune ' }))).toEqual(ok('Pune'));
    expect(parseDraft(cityField, draft({ text: 'x'.repeat(1001) }))).toEqual({
      ok: false,
      error: 'text',
      params: { max: 1000 },
    });
    expect(parseDraft(notesField, draft({ text: 'x'.repeat(4000) }))).toEqual(ok('x'.repeat(4000)));
    expect(parseDraft(notesField, draft({ text: 'x'.repeat(4001) }))).toMatchObject({
      error: 'text',
    });
  });

  it('holds an email and a link to their shape', () => {
    expect(parseDraft(workEmailField, draft({ text: 'a@b.test' }))).toEqual(ok('a@b.test'));
    expect(parseDraft(workEmailField, draft({ text: 'nope' }))).toMatchObject({ error: 'email' });
    expect(parseDraft(websiteField, draft({ text: 'https://example.test/a?b=1' }))).toEqual(
      ok('https://example.test/a?b=1'),
    );
    expect(parseDraft(websiteField, draft({ text: 'example.test' }))).toMatchObject({
      error: 'url',
    });
    expect(parseDraft(websiteField, draft({ text: 'ftp://example.test' }))).toMatchObject({
      error: 'url',
    });
    expect(parseDraft(landlineField, draft({ text: '020 1234' }))).toEqual(ok('020 1234'));
  });

  it('turns numbers into numbers and refuses what is not one', () => {
    expect(parseDraft(visitsField, draft({ text: '12' }))).toEqual(ok(12));
    expect(parseDraft(visitsField, draft({ text: '-3' }))).toEqual(ok(-3));
    expect(parseDraft(visitsField, draft({ text: '1.5' }))).toMatchObject({ error: 'whole' });
    expect(parseDraft(visitsField, draft({ text: 'abc' }))).toMatchObject({ error: 'number' });
    expect(parseDraft(visitsField, draft({ text: '1e3' }))).toMatchObject({ error: 'number' });
    expect(parseDraft(visitsField, draft({ text: '99999999999999999999' }))).toMatchObject({
      error: 'number',
    });
    expect(parseDraft(discountField, draft({ text: '12.5' }))).toEqual(ok(12.5));
    expect(parseDraft(discountField, draft({ text: '.5' }))).toEqual(ok(0.5));
    expect(parseDraft(budgetField, draft({ text: '1,500' }))).toMatchObject({ error: 'number' });
  });

  it('keeps a rating inside its range', () => {
    expect(parseDraft(ratingField, draft({ text: '5' }))).toEqual(ok(5));
    expect(parseDraft(ratingField, draft({ text: '6' }))).toEqual({
      ok: false,
      error: 'range',
      params: { max: 5 },
    });
    expect(parseDraft(ratingField, draft({ text: '-1' }))).toMatchObject({ error: 'range' });
    const noMax = { ...ratingField, config: {} };
    expect(parseDraft(noMax, draft({ text: '5' }))).toEqual(ok(5));
    expect(parseDraft(noMax, draft({ text: '6' }))).toMatchObject({ params: { max: 5 } });
  });

  it('sends a switch as a boolean', () => {
    expect(parseDraft(vipField, draft({ on: true }))).toEqual(ok(true));
    expect(parseDraft(vipField, draft({ on: false }))).toEqual(ok(false));
  });

  it('checks a date as a real calendar day', () => {
    expect(parseDraft(birthdayField, draft({ text: '2026-10-12' }))).toEqual(ok('2026-10-12'));
    expect(parseDraft(birthdayField, draft({ text: '2024-02-29' }))).toEqual(ok('2024-02-29'));
    expect(parseDraft(birthdayField, draft({ text: '2026-02-30' }))).toMatchObject({
      error: 'date',
    });
    expect(parseDraft(birthdayField, draft({ text: '12/10/2026' }))).toMatchObject({
      error: 'date',
    });
  });

  it('needs a date and a time together for a date and time, and joins them', () => {
    expect(parseDraft(nextVisitField, draft({ text: '2026-11-03', time: '14:30' }))).toEqual(
      ok('2026-11-03T14:30'),
    );
    expect(parseDraft(nextVisitField, draft({ text: '2026-11-03' }))).toMatchObject({
      error: 'time',
    });
    expect(parseDraft(nextVisitField, draft({ text: '2026-11-03', time: '24:00' }))).toMatchObject({
      error: 'time',
    });
    expect(parseDraft(nextVisitField, draft({ text: '2026-11-03', time: '9:5' }))).toMatchObject({
      error: 'time',
    });
    expect(parseDraft(nextVisitField, draft({ time: '14:30' }))).toMatchObject({ error: 'date' });
  });

  it('accepts only the options the property has', () => {
    expect(parseDraft(planSelect, draft({ picked: ['pro'] }), options)).toEqual(ok('pro'));
    expect(parseDraft(planSelect, draft({ picked: ['gold'] }), options)).toMatchObject({
      error: 'option',
    });
    const interests = interestsMulti.options ?? [];
    expect(
      parseDraft(interestsMulti, draft({ picked: ['music', 'music', 'travel'] }), interests),
    ).toEqual(ok(['music', 'travel']));
    expect(parseDraft(interestsMulti, draft({ picked: ['golf'] }), interests)).toMatchObject({
      error: 'option',
    });
    expect(parseDraft(interestsMulti, draft({}), interests)).toEqual(ok(null));
  });

  it('refuses a property that cannot be typed in', () => {
    expect(parseDraft(linkField, draft({ text: 'x' }))).toMatchObject({ ok: false });
  });
});

describe('standard fields', () => {
  it('reads the name, email and phone off a contact', () => {
    expect(standardText(profile, 'name')).toBe('Aarav Sharma');
    expect(standardText({ ...profile, name: null }, 'name')).toBe('Aarav Sharma');
    expect(standardText({ ...profile, name: null, firstName: null, lastName: null }, 'name')).toBe(
      '',
    );
    expect(standardText(profile, 'email')).toBe('aarav@example.test');
    expect(standardText({ ...profile, phone: null }, 'phone')).toBe('');
  });

  it('checks a name, an email and a phone the way the API does', () => {
    expect(parseStandard('name', ' Asha ', profile)).toEqual({ ok: true, value: 'Asha' });
    expect(parseStandard('name', '', profile)).toEqual({ ok: true, value: null });
    expect(parseStandard('name', 'x'.repeat(256), profile)).toMatchObject({ error: 'name' });
    expect(parseStandard('email', ' a@b.test ', profile)).toEqual({ ok: true, value: 'a@b.test' });
    expect(parseStandard('email', 'nope', profile)).toMatchObject({ error: 'email' });
    expect(parseStandard('phone', '+91 98765-43210', profile)).toEqual({
      ok: true,
      value: '+919876543210',
    });
    expect(parseStandard('phone', '12345', profile)).toMatchObject({ error: 'phone' });
  });

  it('never leaves a contact with neither a phone nor an email', () => {
    expect(parseStandard('email', '', profile)).toEqual({ ok: true, value: null });
    expect(parseStandard('email', '', { ...profile, phone: null })).toMatchObject({
      error: 'needPhoneOrEmail',
    });
    expect(parseStandard('phone', '', { ...profile, email: null })).toMatchObject({
      error: 'needPhoneOrEmail',
    });
  });

  it('builds the update for one property', () => {
    const custom = { kind: 'custom', field: cityField } as const;
    expect(updateBodyFor(custom, 'Delhi')).toEqual({ customFields: { city: 'Delhi' } });
    expect(updateBodyFor(custom, null)).toEqual({ customFields: { city: null } });
    expect(updateBodyFor({ kind: 'standard', key: 'name' }, 'Asha')).toEqual({ name: 'Asha' });
    expect(updateBodyFor({ kind: 'standard', key: 'email' }, null)).toEqual({ email: null });
    expect(updateBodyFor({ kind: 'standard', key: 'phone' }, '+911')).toEqual({ phone: '+911' });
  });

  it('reads the current value and the starting draft of what is being edited', () => {
    const custom = { kind: 'custom', field: cityField } as const;
    expect(currentValueOf(custom, profile)).toBe('Pune');
    expect(currentValueOf({ kind: 'standard', key: 'phone' }, profile)).toBe('+919812345678');
    expect(initialDraftOf(custom, profile).text).toBe('Pune');
    expect(initialDraftOf({ kind: 'standard', key: 'email' }, profile).text).toBe(
      'aarav@example.test',
    );
    expect(parseEdit(custom, draft({ text: 'Goa' }), [], profile)).toEqual({
      ok: true,
      value: 'Goa',
    });
    expect(parseEdit({ kind: 'standard', key: 'name' }, draft({ text: 'A' }), [], profile)).toEqual(
      { ok: true, value: 'A' },
    );
  });

  it('knows when a save would change nothing', () => {
    expect(sameValue('Pune', 'Pune')).toBe(true);
    expect(sameValue('', null)).toBe(true);
    expect(sameValue(undefined, null)).toBe(true);
    expect(sameValue(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameValue(['a'], ['b'])).toBe(false);
    expect(sameValue(false, null)).toBe(false);
  });
});

describe('buildRows', () => {
  const rows = (over: Partial<Parameters<typeof buildRows>[0]> = {}) =>
    buildRows({
      contact: profile,
      fields: fieldDefinitions,
      ownerName: priya.fullName,
      locale: 'en',
      t,
      ...over,
    });

  it('lists the fixed rows first, in order, then the properties', () => {
    const ids = rows().map((r) => r.id);
    expect(ids.slice(0, 13)).toEqual([
      'email',
      'phone',
      'owner',
      'name',
      'source',
      'whatsapp',
      'emailSubscription',
      'smsSubscription',
      'marketing',
      'leadScore',
      'created',
      'modified',
      'lastActivity',
    ]);
    expect(ids[13]).toBe('field:city');
  });

  it('shows the email and SMS subscription and the modified time beside the WhatsApp one', () => {
    const contact = {
      ...profile,
      emailSubscriptionStatus: 'subscribed',
      smsSubscriptionStatus: 'unsubscribed',
      updatedAt: '2026-10-18T15:16:00.000Z',
    };
    const byId = (id: string) => rows({ contact }).find((r) => r.id === id);
    expect(byId('emailSubscription')?.text).toBe('Subscribed');
    expect(byId('smsSubscription')?.text).toBe('Unsubscribed');
    expect(byId('modified')?.text).toBe(formatMoment('2026-10-18T15:16:00.000Z', 'en'));
    expect(byId('emailSubscription')?.edit.kind).toBe('locked');
    expect(rows({ contact: bare }).find((r) => r.id === 'smsSubscription')?.text).toBeNull();
  });

  it('shows the owner by name, and by nothing when the name cannot be found', () => {
    expect(rows().find((r) => r.id === 'owner')?.text).toBe('Priya Nair');
    expect(rows({ ownerName: null }).find((r) => r.id === 'owner')?.text).toBe(NO_VALUE);
    expect(rows({ contact: bare }).find((r) => r.id === 'owner')?.text).toBeNull();
  });

  it('marks which rows can be edited', () => {
    const edits = Object.fromEntries(rows().map((r) => [r.id, r.edit.kind]));
    expect(edits).toMatchObject({
      email: 'standard',
      phone: 'standard',
      owner: 'owner',
      name: 'standard',
      source: 'locked',
      created: 'locked',
      'field:city': 'custom',
      'field:tax_id': 'locked',
      'field:total': 'locked',
      'field:sys': 'locked',
      'field:secret': 'locked',
      'field:account': 'locked',
    });
  });

  it('leaves out hidden and switched-off properties, and shows a value nobody defined under its key', () => {
    const all = rows();
    const ids = all.map((r) => r.id);
    expect(ids).not.toContain('field:internal');
    expect(ids).not.toContain('field:old');
    const stray = all.find((r) => r.id === 'field:stray');
    expect(stray).toMatchObject({ label: 'stray', text: 'kept', edit: { kind: 'locked' } });
    expect(all.find((r) => r.id === 'field:secret')?.text).toBe(MASKED);
    expect(all.find((r) => r.id === 'field:plan')?.text).toBe('Pro');
    expect(all.find((r) => r.id === 'field:vip')?.text).toBe('Yes');
  });

  it('shows every value under its key when the definitions are not there', () => {
    const custom = rows({ fields: undefined }).slice(10);
    expect(custom.find((r) => r.id === 'field:city')).toMatchObject({
      label: 'city',
      text: 'Pune',
      edit: { kind: 'locked' },
    });
    expect(custom.find((r) => r.id === 'field:vip')?.text).toBe('Yes');
  });

  it('reads the fixed values', () => {
    const byId = Object.fromEntries(rows().map((r) => [r.id, r.text]));
    expect(byId).toMatchObject({
      email: 'aarav@example.test',
      phone: '+919812345678',
      name: 'Aarav Sharma',
      source: 'import',
      whatsapp: 'Subscribed',
      marketing: 'No',
      leadScore: '40',
    });
    expect(byId.created).toBe(formatDate(profile.createdAt, 'en'));
    expect(byId.lastActivity).toBe(formatMoment(profile.lastActivityAt, 'en'));
    const optedOut = buildRows({
      contact: { ...profile, isUnsubscribed: true, whatsappSubscriptionStatus: 'weird_state' },
      fields: [],
      ownerName: null,
      locale: 'en',
      t,
    });
    expect(optedOut.find((r) => r.id === 'marketing')?.text).toBe('Yes');
    expect(optedOut.find((r) => r.id === 'whatsapp')?.text).toBe('Weird State');
  });

  it('hides the empty rows until asked to show them', () => {
    const all = buildRows({
      contact: bare,
      fields: [cityField, retiredField],
      ownerName: null,
      locale: 'en',
      t,
    });
    expect(visibleRows(all, false).map((r) => r.id)).toEqual([
      'email',
      'phone',
      'name',
      'marketing',
      'created',
      'modified',
    ]);
    const shown = visibleRows(all, true);
    expect(shown).toHaveLength(all.length);
    expect(shown.map((r) => r.id)).toContain('field:city');
    expect(shown.find((r) => r.id === 'field:city')?.text).toBeNull();
  });
});

describe('lifecycle options', () => {
  it('lists the active options of a group in the workspace order', () => {
    expect(optionsOfGroup(statusOptions, ['lifecycle_stage']).map((o) => o.value)).toEqual([
      'new',
      'qualified',
      'lost',
      'enrolled',
    ]);
    expect(optionsOfGroup(statusOptions, ['status']).map((o) => o.value)).toEqual([
      'Open',
      'Hot',
      'Closed',
    ]);
    expect(optionsOfGroup(undefined, ['status'])).toEqual([]);
  });

  it('offers the statuses that belong to a stage, and every unscoped one', () => {
    expect(statusesForStage(statusOptions, stageQualified).map((o) => o.value)).toEqual([
      'Open',
      'Hot',
    ]);
    expect(statusesForStage(statusOptions, stageLost).map((o) => o.value)).toEqual([
      'Open',
      'Closed',
    ]);
    expect(statusesForStage(statusOptions, stageNew).map((o) => o.value)).toEqual(['Open']);
    expect(statusesForStage(statusOptions, undefined).map((o) => o.value)).toEqual([
      'Open',
      'Hot',
      'Closed',
    ]);
  });

  it('reads the stage scope the way the API does', () => {
    expect(statusScope(statusOptions).find((r) => r.value === 'Hot')?.stageValue).toBe('qualified');
    expect(statusFitsStage(statusOptions, 'Hot', 'qualified')).toBe(true);
    expect(statusFitsStage(statusOptions, 'Hot', 'lost')).toBe(false);
    expect(statusFitsStage(statusOptions, 'Open', 'lost')).toBe(true);
    expect(statusFitsStage(statusOptions, null, 'lost')).toBe(true);
    expect(statusHot.stageOptionId).toBe(stageQualified.id);
  });
});

describe('lifecycleChanges', () => {
  const contact = { lifecycleStage: 'new', status: 'Open' };
  const base = { stage: 'new', status: 'Open', reason: null, reasonText: '' };

  it('sends nothing when nothing changed', () => {
    expect(lifecycleChanges(contact, base, false, true)).toEqual({ ok: true, changes: {} });
  });

  it('sends only what differs', () => {
    expect(lifecycleChanges(contact, { ...base, stage: 'qualified' }, false, true)).toEqual({
      ok: true,
      changes: { lifecycleStage: 'qualified' },
    });
    expect(lifecycleChanges(contact, { ...base, status: 'Hot' }, false, true)).toEqual({
      ok: true,
      changes: { status: 'Hot' },
    });
    // A status dropped by a stage move is left out, so the API applies its own rule.
    expect(
      lifecycleChanges(contact, { ...base, stage: 'qualified', status: null }, false, true),
    ).toEqual({ ok: true, changes: { lifecycleStage: 'qualified' } });
  });

  it('asks for a reason when moving into a lost stage', () => {
    const lost = { ...base, stage: 'lost' };
    expect(lifecycleChanges(contact, lost, true, true)).toEqual({ ok: false });
    expect(lifecycleChanges(contact, lost, true, false)).toEqual({ ok: false });
    expect(lifecycleChanges(contact, { ...lost, reason: reasonPrice.value }, true, true)).toEqual({
      ok: true,
      changes: { lifecycleStage: 'lost', lostReason: 'too_expensive', otherLostReason: null },
    });
    expect(
      lifecycleChanges(
        contact,
        { ...lost, reason: OTHER_REASON, reasonText: '  Moved away ' },
        true,
        true,
      ),
    ).toEqual({
      ok: true,
      changes: { lifecycleStage: 'lost', otherLostReason: 'Moved away', lostReason: null },
    });
    expect(lifecycleChanges(contact, { ...lost, reasonText: 'Moved away' }, true, false)).toEqual({
      ok: true,
      changes: { lifecycleStage: 'lost', otherLostReason: 'Moved away', lostReason: null },
    });
    expect(lifecycleChanges(contact, { ...lost, reason: OTHER_REASON }, true, true)).toEqual({
      ok: false,
    });
  });
});

describe('groupRows and searchRows', () => {
  const sectionOf = (id: string, name: string, position: number, isActive = true) => ({
    id,
    moduleKey: 'contacts' as const,
    name,
    position,
    isActive,
    rowVersion: 1,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
  });
  const row = (id: string, label: string, text: string | null) => ({
    id,
    label,
    text,
    edit: { kind: 'locked', reason: 'readonly' } as const,
  });
  const defined = (key: string, sectionId: string | null) =>
    ({ key, sectionId }) as unknown as FieldResponse;

  it('puts the fixed rows first, then each section in its set order, then what sits in none', () => {
    const rows = [
      row('email', 'Email', 'a@b.test'),
      row('field:city', 'City', 'Pune'),
      row('field:plan', 'Plan', 'Pro'),
      row('field:stray', 'stray', 'kept'),
    ];
    const groups = groupRows(
      rows,
      [defined('city', 'b'), defined('plan', 'a')],
      [sectionOf('b', 'Location', 2), sectionOf('a', 'Billing', 1)],
    );
    expect(groups.map((g) => [g.title, g.rows.map((r) => r.id)])).toEqual([
      [null, ['email']],
      ['Billing', ['field:plan']],
      ['Location', ['field:city']],
      [null, ['field:stray']],
    ]);
  });

  it('leaves out a section with nothing to show and treats a switched-off section as none', () => {
    const groups = groupRows(
      [row('field:city', 'City', 'Pune')],
      [defined('city', 'off')],
      [sectionOf('off', 'Old', 1, false), sectionOf('empty', 'Empty', 2)],
    );
    expect(groups).toEqual([
      { title: null, rows: [expect.objectContaining({ id: 'field:city' })] },
    ]);
  });

  it('keeps every row in one headerless group when nothing is known about sections', () => {
    const rows = [row('email', 'Email', 'x'), row('field:city', 'City', 'Pune')];
    expect(groupRows(rows, undefined, undefined).map((g) => g.title)).toEqual([null, null]);
  });

  it('searches the name and the value, ignoring case, and keeps all rows for an empty search', () => {
    const rows = [row('a', 'City', 'Pune'), row('b', 'Plan', 'Pro'), row('c', 'Empty', null)];
    expect(searchRows(rows, 'pun').map((r) => r.id)).toEqual(['a']);
    expect(searchRows(rows, ' PLAN ').map((r) => r.id)).toEqual(['b']);
    expect(searchRows(rows, 'nothing')).toEqual([]);
    expect(searchRows(rows, '  ').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('stageChoices and statusChoices', () => {
  const label = (value: string) => `<${value}>`;

  it("offers the workspace's own stages, with a stage the contact holds but the list lacks first", () => {
    expect(stageChoices(statusOptions, label, 'qualified').map((c) => c.value)).toEqual([
      'new',
      'qualified',
      'lost',
      'enrolled',
    ]);
    expect(stageChoices(statusOptions, label, 'on_hold').map((c) => c.label)).toEqual([
      '<on_hold>',
      'New lead',
      'Qualified',
      'Lost',
      'Enrolled',
    ]);
  });

  it("offers the platform's ten stages when the workspace has none", () => {
    const stages = stageChoices([], label, 'new');
    expect(stages).toHaveLength(10);
    expect(stages[0]).toEqual({ value: 'new', label: '<new>' });
    expect(stages.at(-1)?.value).toBe('lost');
  });

  it("offers the workspace's statuses valid in the stage, never the built-in four beside them", () => {
    const hot = statusChoices(statusOptions, stageQualified, label, null);
    expect(hot.map((c) => c.value)).toEqual(['Open', 'Hot']);
    const lost = statusChoices(statusOptions, stageLost, label, null);
    expect(lost.map((c) => c.value)).toEqual(['Open', 'Closed']);
  });

  it('offers the four built-in statuses when the workspace has none, and keeps the one the contact holds', () => {
    const none = statusOptions.filter((o) => o.optionGroup !== 'status');
    expect(statusChoices(none, stageQualified, label, null).map((c) => c.value)).toEqual([
      'active',
      'prospect',
      'customer',
      'vip',
    ]);
    expect(statusChoices(none, undefined, label, 'Won').map((c) => c.value)[0]).toBe('Won');
  });

  it('starts a stage at its default status, else the first one', () => {
    expect(firstStatusOf([])).toBeNull();
    expect(
      firstStatusOf([
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B', isDefault: true },
      ]),
    ).toBe('b');
    expect(
      firstStatusOf([
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ]),
    ).toBe('a');
  });
});

describe('standard properties read from the contact', () => {
  const standard = {
    stageLabel: (value: string) => `<${value}>`,
    lostReasonLabel: (value: string) => `[${value}]`,
  };
  const contact = {
    ...profile,
    email: 'a@example.test',
    phone: '+919812345678',
    firstName: 'Aarav',
    lastName: null,
    lifecycleStage: 'qualified',
    previousLifecycleStage: 'new',
    status: 'Open',
    lostReason: 'too_expensive',
    otherLostReason: 'Moved abroad',
    lifecycleStageDate: '2026-10-01T09:00:00.000Z',
    previousLifecycleStageDate: null,
    whatsappSubscriptionStatus: 'subscribed',
    emailSubscriptionStatus: null,
    smsSubscriptionStatus: 'unsubscribed',
    source: 'import',
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-10-02T08:00:00.000Z',
  };
  const ctx = { t, standard, ownerName: 'Priya Nair', locale: 'en' };
  const text = (key: string) => columnTextOf(contact, key, ctx);

  it('reads each standard key from its column', () => {
    expect(text('email')).toBe('a@example.test');
    expect(text('mobile_phone_number')).toBe('+919812345678');
    expect(text('first_name')).toBe('Aarav');
    expect(text('lifecycle_stage')).toBe('<qualified>');
    expect(text('previous_lifecycle_stage')).toBe('<new>');
    expect(text('lifecycle_stage_status')).toBe('Open');
    expect(text('lost_reason')).toBe('[too_expensive]');
    expect(text('other_lost_reason')).toBe('Moved abroad');
    expect(text('contact_owner')).toBe('Priya Nair');
    expect(text('source')).toBe('import');
    expect(text('whatsapp_subscription_status')).toBe('Subscribed');
    expect(text('sms_subscription_status')).toBe('Unsubscribed');
    expect(text('lifecycle_stage_date')).toBe(formatMoment('2026-10-01T09:00:00.000Z', 'en'));
    expect(text('modified_time')).toBe(formatMoment('2026-10-02T08:00:00.000Z', 'en'));
  });

  it('has nothing for an empty column, an unknown key, or when the screen did not ask', () => {
    expect(text('last_name')).toBeNull();
    expect(text('email_subscription_status')).toBeNull();
    expect(text('previous_lifecycle_stage_date')).toBeNull();
    expect(text('city')).toBeNull();
    expect(columnTextOf(contact, 'email', { ...ctx, standard: undefined })).toBeNull();
  });

  it('lets a custom value win and leaves the About tab alone unless asked', () => {
    const email = field({ key: 'email', label: 'Email', fieldType: 'email', isSystem: true });
    const base = { contact, fields: [email], ownerName: null, locale: 'en', t };
    const row = (extra: object) =>
      buildRows({ ...base, ...extra }).find((r) => r.id === 'field:email')?.text;
    expect(row({})).toBeNull();
    expect(row({ standard })).toBe('a@example.test');
    expect(
      row({ standard, contact: { ...contact, customFields: { email: 'x@example.test' } } }),
    ).toBe('x@example.test');
  });
});
