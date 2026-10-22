import { describe, expect, it } from 'vitest';
import type { BookingType } from '../api/schemas';
import { emptyWeek } from './availability';
import { newReminder } from './reminder-rules';
import {
  canPreview,
  draftToInput,
  firstProblemStep,
  newDraft,
  optionsOf,
  previewDraft,
  slugify,
  typeToDraft,
  validateDraft,
  type BookingTypeDraft,
} from './booking-form';

const base = (): BookingTypeDraft => ({
  ...newDraft({ timezone: 'Asia/Kolkata', currency: 'INR' }),
  name: 'Demo',
});

const stored: BookingType = {
  id: 't1',
  name: 'Haircut',
  slug: 'haircut',
  description: null,
  locationType: 'address',
  locationValue: '12 MG Road',
  color: '#2563EB',
  durationMinutes: 45,
  incrementMinutes: 15,
  bufferBeforeMinutes: 5,
  bufferAfterMinutes: 10,
  minNoticeMinutes: 120,
  maxAdvanceDays: 60,
  maxPerDay: 12,
  capacity: 2,
  requiresApproval: true,
  timezone: 'Asia/Kolkata',
  introMessage: 'Welcome',
  isActive: true,
  sortOrder: 0,
  price: {
    currency: 'INR',
    feeMinor: 15000,
    taxPct: 18,
    depositMode: 'partial',
    depositValueMinor: 5000,
    gatewaySlug: 'razorpay',
    autoSendLink: true,
    cancelFeeMinor: 2000,
    noShowFeeMinor: 0,
    cancelWindowMinutes: 1440,
  },
  integration: {
    calendarId: null,
    createMeet: false,
    spreadsheetId: null,
    sheetRange: 'Sheet1!A1',
  },
  availability: [{ weekday: 2, from: '10:00', to: '18:00' }],
  overrides: [{ date: '2026-12-25', closed: true, from: null, to: null, reason: 'Christmas' }],
  templates: [
    {
      event: 'reminder',
      channel: 'whatsapp',
      waTemplateId: null,
      libraryTemplateId: null,
      plainBody: 'See you {{slot}}',
    },
  ],
  reminders: [
    {
      id: 'r-180',
      offsetMinutes: 180,
      label: '3h',
      isActive: true,
      kind: 'before',
      channels: ['whatsapp', 'email'],
      subject: null,
      body: 'Hi {{name}}',
      waTemplateId: null,
    },
    {
      id: 'r-1440',
      offsetMinutes: 1440,
      label: '24h',
      isActive: false,
      kind: 'before',
      channels: ['whatsapp', 'email'],
      subject: null,
      body: null,
      waTemplateId: null,
    },
    {
      id: 'r-after',
      offsetMinutes: 120,
      label: null,
      isActive: true,
      kind: 'after',
      channels: ['email'],
      subject: 'Thanks',
      body: null,
      waTemplateId: null,
    },
  ],
  questions: [
    {
      label: 'Style',
      type: 'select',
      options: ['Short', 'Long'],
      required: true,
      mapToContactField: null,
    },
  ],
  appointmentsCount: 3,
  publicUrl: 'https://x.test/book/acme/haircut',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

describe('new type', () => {
  it('starts with Reference defaults and passes validation once named', () => {
    const d = base();
    expect(d.duration).toBe('30');
    expect(d.minNotice).toBe('240');
    expect(d.maxAdvance).toBe('30');
    expect(validateDraft(d)).toEqual({});
    expect(validateDraft({ ...d, name: '  ' }).name).toBe('nameRequired');
  });
});

describe('validation', () => {
  it('applies the controller limits', () => {
    const d = base();
    const bad: Array<[Partial<BookingTypeDraft>, string, string]> = [
      [{ name: 'x'.repeat(192) }, 'name', 'nameTooLong'],
      [{ duration: '4' }, 'duration', 'durationInvalid'],
      [{ duration: '1441' }, 'duration', 'durationInvalid'],
      [{ duration: '' }, 'duration', 'durationInvalid'],
      [{ duration: '30.5' }, 'duration', 'durationInvalid'],
      [{ increment: '4' }, 'increment', 'incrementInvalid'],
      [{ bufferBefore: '1441' }, 'bufferBefore', 'bufferInvalid'],
      [{ bufferAfter: '-1' }, 'bufferAfter', 'bufferInvalid'],
      [{ minNotice: 'abc' }, 'minNotice', 'minNoticeInvalid'],
      [{ maxAdvance: '0' }, 'maxAdvance', 'maxAdvanceInvalid'],
      [{ maxAdvance: '366' }, 'maxAdvance', 'maxAdvanceInvalid'],
      [{ maxPerDay: '0' }, 'maxPerDay', 'maxPerDayInvalid'],
      [{ maxPerDay: '501' }, 'maxPerDay', 'maxPerDayInvalid'],
      [{ capacity: '0' }, 'capacity', 'capacityInvalid'],
      [{ capacity: '501' }, 'capacity', 'capacityInvalid'],
      [{ timezone: 'Mars/Base' }, 'timezone', 'timezoneInvalid'],
      [{ color: 'green' }, 'color', 'colorInvalid'],
      [{ slug: 'Not A Slug' }, 'slug', 'slugInvalid'],
      [{ fee: '-5' }, 'fee', 'feeInvalid'],
      [{ taxPct: '101' }, 'taxPct', 'taxInvalid'],
      [{ cancelFee: 'x' }, 'cancelFee', 'cancelFeeInvalid'],
    ];
    for (const [patch, key, code] of bad)
      expect(validateDraft({ ...d, ...patch })[key], key).toBe(code);
    // Boundaries that are fine.
    for (const patch of [
      { duration: '5' },
      { duration: '1440' },
      { maxAdvance: '365' },
      { capacity: '500' },
      { maxPerDay: '' },
      { increment: '' },
      { slug: 'demo-2' },
    ]) {
      expect(validateDraft({ ...d, ...patch }), JSON.stringify(patch)).toEqual({});
    }
  });

  it('needs a partial deposit that is positive and not above the total', () => {
    const d = { ...base(), fee: '100', taxPct: '10', depositMode: 'partial' as const };
    expect(validateDraft({ ...d, deposit: '0' }).deposit).toBe('depositInvalid');
    expect(validateDraft({ ...d, deposit: '110.01' }).deposit).toBe('depositTooHigh');
    expect(validateDraft({ ...d, deposit: '110' }).deposit).toBeUndefined();
    // Not asked for when there is no partial deposit.
    expect(validateDraft({ ...d, depositMode: 'full', deposit: 'junk' }).deposit).toBeUndefined();
  });

  it('wants reminders to be positive, distinct and at most five', () => {
    const d = base();
    const r = (id: string, offset: string) => ({ ...newReminder(offset), id });
    expect(validateDraft({ ...d, reminders: [r('a', '1440'), r('b', '1440')] })['reminder:b']).toBe(
      'remindersDuplicate',
    );
    expect(validateDraft({ ...d, reminders: [r('a', '0')] })['reminder:a']).toBe('reminderInvalid');
    expect(validateDraft({ ...d, reminders: [r('a', 'soon')] })['reminder:a']).toBe(
      'reminderInvalid',
    );
    expect(validateDraft({ ...d, reminders: [r('a', '')] })).toEqual({});
    const nine = Array.from({ length: 6 }, (_, i) => r(`r${i}`, String((i + 1) * 60)));
    expect(validateDraft({ ...d, reminders: nine }).reminders).toBe('remindersTooMany');
    expect(validateDraft({ ...d, reminders: nine.slice(0, 5) }).reminders).toBeUndefined();
  });

  it('wants a select question to have choices, and ignores a blank question row', () => {
    const d = base();
    const q = (over: Partial<BookingTypeDraft['questions'][number]>) => ({
      id: 'q',
      label: 'Style',
      type: 'text' as const,
      optionsText: '',
      required: true,
      map: '',
      ...over,
    });
    expect(validateDraft({ ...d, questions: [q({ type: 'select' })] })['question:q']).toBe(
      'questionOptionsRequired',
    );
    expect(
      validateDraft({ ...d, questions: [q({ type: 'select', optionsText: 'A\nB' })] }),
    ).toEqual({});
    expect(validateDraft({ ...d, questions: [q({ label: '' })] })).toEqual({});
    expect(validateDraft({ ...d, questions: [q({ label: '', map: 'email' })] })['question:q']).toBe(
      'questionLabelRequired',
    );
  });

  it('flags broken hours and overrides and says which step to show', () => {
    const d = base();
    d.week[1] = [{ id: 'x', from: '10:00', to: '09:00' }];
    const p = validateDraft(d);
    expect(p.hours).toBe('hoursInvalid');
    expect(firstProblemStep(p)).toBe('availability');
    expect(firstProblemStep({ name: 'nameRequired', hours: 'hoursInvalid' })).toBe('service');
    expect(firstProblemStep({ fee: 'feeInvalid', 'reminder:a': 'reminderInvalid' })).toBe(
      'pricing',
    );
    expect(firstProblemStep({})).toBeNull();
  });
});

describe('conversion', () => {
  it('round-trips a stored type', () => {
    const d = typeToDraft(stored);
    expect(d.fee).toBe('150.00');
    expect(d.deposit).toBe('50.00');
    expect(d.maxPerDay).toBe('12');
    expect(validateDraft(d)).toEqual({});
    const input = draftToInput(d);
    expect(input).toMatchObject({
      name: 'Haircut',
      slug: 'haircut',
      color: '#2563EB',
      durationMinutes: 45,
      incrementMinutes: 15,
      maxPerDay: 12,
      capacity: 2,
      requiresApproval: true,
    });
    expect(input.price).toMatchObject({
      feeMinor: 15000,
      depositMode: 'partial',
      depositValueMinor: 5000,
      taxPct: 18,
      cancelFeeMinor: 2000,
    });
    expect(input.availability).toEqual([{ weekday: 2, from: '10:00', to: '18:00' }]);
    expect(input.overrides).toEqual([
      { date: '2026-12-25', closed: true, from: null, to: null, reason: 'Christmas' },
    ]);
    // Reminders go out furthest first, then the follow-ups; a saved rule keeps its id, its switch and its channels.
    expect(input.reminders.map((r) => [r.kind, r.offsetMinutes, r.isActive])).toEqual([
      ['before', 1440, false],
      ['before', 180, true],
      ['after', 120, true],
    ]);
    expect(input.reminders[0]).toMatchObject({ id: 'r-1440' });
    expect(input.reminders[1]).toMatchObject({
      id: 'r-180',
      channels: ['whatsapp', 'email'],
      body: 'Hi {{name}}',
    });
    expect(input.reminders[2]).toMatchObject({ subject: 'Thanks', channels: ['email'] });
    expect(input.questions).toEqual([
      {
        label: 'Style',
        type: 'select',
        options: ['Short', 'Long'],
        required: true,
        mapToContactField: null,
      },
    ]);
    expect(input.templates).toEqual([
      {
        event: 'reminder',
        channel: 'whatsapp',
        waTemplateId: null,
        libraryTemplateId: null,
        plainBody: 'See you {{slot}}',
      },
    ]);
  });

  it('uses the duration for a blank start step and drops empty children', () => {
    const d = {
      ...base(),
      increment: '',
      maxPerDay: '',
      bufferBefore: '',
      reminders: [newReminder('')],
      questions: [
        { id: 'q', label: ' ', type: 'text' as const, optionsText: '', required: true, map: '' },
      ],
    };
    const input = draftToInput(d);
    expect(input.incrementMinutes).toBe(30);
    expect(input.maxPerDay).toBeNull();
    expect(input.bufferBeforeMinutes).toBe(0);
    expect(input.reminders).toEqual([]);
    expect(input.questions).toEqual([]);
    expect(input.templates).toEqual([]);
  });

  it('creates a Meet link for a virtual service', () => {
    expect(draftToInput({ ...base(), locationType: 'virtual' }).integration.createMeet).toBe(true);
    expect(draftToInput(base()).integration.createMeet).toBe(false);
  });

  it('clears the deposit unless it is partial and keeps only what changes the choices of a select', () => {
    expect(
      draftToInput({ ...base(), depositMode: 'full', deposit: '25' }).price.depositValueMinor,
    ).toBe(0);
    const d = {
      ...base(),
      questions: [
        {
          id: 'q',
          label: 'Q',
          type: 'text' as const,
          optionsText: 'a\nb',
          required: false,
          map: 'email',
        },
      ],
    };
    expect(draftToInput(d).questions[0]).toEqual({
      label: 'Q',
      type: 'text',
      options: [],
      required: false,
      mapToContactField: 'email',
    });
  });

  it('turns a list of choices into unique, trimmed options', () => {
    expect(optionsOf({ optionsText: ' A \n\nb\nB\n a\nC' })).toEqual(['A', 'b', 'C']);
    expect(
      optionsOf({ optionsText: Array.from({ length: 30 }, (_, i) => `o${i}`).join('\n') }),
    ).toHaveLength(20);
  });
});

describe('preview', () => {
  it('reads the draft the preview endpoint needs', () => {
    const p = previewDraft(base());
    expect(p).toMatchObject({
      timezone: 'Asia/Kolkata',
      durationMinutes: 30,
      incrementMinutes: 30,
      minNoticeMinutes: 240,
      maxAdvanceDays: 30,
      maxPerDay: null,
      capacity: 1,
    });
    expect(p.availability).toHaveLength(5);
  });

  it('only previews when there is something to preview', () => {
    expect(canPreview(base())).toBe(true);
    expect(canPreview({ ...base(), week: emptyWeek() })).toBe(false);
    expect(canPreview({ ...base(), duration: '2' })).toBe(false);
    expect(canPreview({ ...base(), timezone: 'nope' })).toBe(false);
  });
});

describe('slugify', () => {
  it('makes a link-safe name', () => {
    expect(slugify('30-min Demo')).toBe('30-min-demo');
    expect(slugify('  Café & Bar!! ')).toBe('cafe-bar');
    expect(slugify('مرحبا')).toBe('');
    expect(slugify('a'.repeat(100)).length).toBe(64);
  });
});
