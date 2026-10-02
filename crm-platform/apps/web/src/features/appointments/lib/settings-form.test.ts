import { describe, expect, it } from 'vitest';
import type { BookingSettings } from '../api/schemas';
import { addInterval, defaultWeek, emptyWeek, rulesFromWeek } from './availability';
import { relativeTime } from './relative';
import {
  DEFAULT_NUMBERS,
  DEFAULT_TEMPLATES,
  LIMITS,
  LOCATION_MAX,
  NUMBER_FIELDS,
  PLACEHOLDERS,
  TEMPLATE_MAX,
  draftFromSettings,
  fieldKeyOf,
  hasNoHours,
  isDefaultTemplate,
  isDirty,
  parseWhole,
  toInput,
  unknownPlaceholders,
  validateDraft,
  type NumberField,
  type SettingsDraft,
} from './settings-form';

const settings = (over: Partial<BookingSettings> = {}): BookingSettings => ({
  timezone: 'Asia/Kolkata',
  slotDurationMinutes: 30,
  bufferBeforeMinutes: 5,
  bufferAfterMinutes: 10,
  maxPerDay: 16,
  advanceDays: 14,
  reminderMinutesBefore: 60,
  defaultLocation: '12 MG Road',
  businessHours: rulesFromWeek(defaultWeek()),
  templates: { ...DEFAULT_TEMPLATES },
  calendar: {
    provider: 'google',
    status: 'unavailable',
    calendarId: null,
    calendarName: null,
    connectedAt: null,
  },
  rowVersion: 3,
  ...over,
});

const draft = (over: Partial<SettingsDraft> = {}): SettingsDraft => ({
  ...draftFromSettings(settings(), 'UTC'),
  ...over,
});
const withNumber = (f: NumberField, v: string): SettingsDraft => {
  const d = draft();
  return { ...d, numbers: { ...d.numbers, [f]: v } };
};

describe('limits (Reference saveSettings)', () => {
  it('has the exact ranges', () => {
    expect(LIMITS).toEqual({
      slotDurationMinutes: { min: 5, max: 480 },
      maxPerDay: { min: 1, max: 96 },
      bufferBeforeMinutes: { min: 0, max: 240 },
      bufferAfterMinutes: { min: 0, max: 240 },
      advanceDays: { min: 1, max: 90 },
      reminderMinutesBefore: { min: 0, max: 1440 },
    });
    expect(LOCATION_MAX).toBe(191);
  });

  it('accepts a value at each boundary', () => {
    for (const f of NUMBER_FIELDS) {
      expect(validateDraft(withNumber(f, String(LIMITS[f].min)))[f]).toBeUndefined();
      expect(validateDraft(withNumber(f, String(LIMITS[f].max)))[f]).toBeUndefined();
    }
  });

  it('refuses one step outside each boundary', () => {
    for (const f of NUMBER_FIELDS) {
      expect(validateDraft(withNumber(f, String(LIMITS[f].min - 1)))[f]).toEqual({
        code: 'tooSmall',
        params: LIMITS[f],
      });
      expect(validateDraft(withNumber(f, String(LIMITS[f].max + 1)))[f]).toEqual({
        code: 'tooLarge',
        params: LIMITS[f],
      });
    }
  });

  it('0 turns reminders off but is not a valid slot length or daily cap', () => {
    expect(
      validateDraft(withNumber('reminderMinutesBefore', '0')).reminderMinutesBefore,
    ).toBeUndefined();
    expect(validateDraft(withNumber('slotDurationMinutes', '0')).slotDurationMinutes?.code).toBe(
      'tooSmall',
    );
    expect(validateDraft(withNumber('maxPerDay', '0')).maxPerDay?.code).toBe('tooSmall');
    expect(validateDraft(withNumber('advanceDays', '0')).advanceDays?.code).toBe('tooSmall');
  });

  it('names an empty box and a non-number differently', () => {
    expect(validateDraft(withNumber('maxPerDay', '')).maxPerDay).toEqual({ code: 'required' });
    expect(validateDraft(withNumber('maxPerDay', '   ')).maxPerDay).toEqual({ code: 'required' });
    for (const bad of ['abc', '12.5', '1e3', '--4', '4 5']) {
      expect(validateDraft(withNumber('maxPerDay', bad)).maxPerDay).toEqual({ code: 'notInteger' });
    }
  });

  it('allows surrounding spaces and a leading zero', () => {
    expect(validateDraft(withNumber('maxPerDay', ' 08 ')).maxPerDay).toBeUndefined();
    expect(parseWhole(' 08 ')).toBe(8);
    expect(parseWhole('')).toBeNull();
  });

  it('caps the default location at 191 characters', () => {
    expect(
      validateDraft(draft({ defaultLocation: 'x'.repeat(191) })).defaultLocation,
    ).toBeUndefined();
    expect(validateDraft(draft({ defaultLocation: 'x'.repeat(192) })).defaultLocation).toEqual({
      code: 'tooLong',
      params: { max: 191 },
    });
    expect(validateDraft(draft({ defaultLocation: '' })).defaultLocation).toBeUndefined();
    // Counted in characters, not UTF-16 units.
    expect(
      validateDraft(draft({ defaultLocation: '😀'.repeat(191) })).defaultLocation,
    ).toBeUndefined();
  });
});

describe('time zone', () => {
  it('takes the workspace zone, else the viewer, else UTC', () => {
    expect(draftFromSettings(settings({ timezone: 'Europe/Paris' }), 'Asia/Tokyo').timezone).toBe(
      'Europe/Paris',
    );
    expect(draftFromSettings(settings({ timezone: null }), 'Asia/Tokyo').timezone).toBe(
      'Asia/Tokyo',
    );
    expect(draftFromSettings(settings({ timezone: 'Not/AZone' }), 'Asia/Tokyo').timezone).toBe(
      'Asia/Tokyo',
    );
    expect(draftFromSettings(settings({ timezone: null }), 'nonsense').timezone).toBe('UTC');
  });

  it('refuses a zone that does not exist', () => {
    expect(validateDraft(draft({ timezone: 'Mars/Olympus' })).timezone).toEqual({
      code: 'badZone',
    });
    expect(validateDraft(draft({ timezone: '' })).timezone).toEqual({ code: 'badZone' });
    expect(validateDraft(draft({ timezone: 'America/New_York' })).timezone).toBeUndefined();
  });
});

describe('business hours', () => {
  it('passes the default week', () => {
    expect(validateDraft(draft()).businessHours).toBeUndefined();
  });

  it('flags an interval whose end is not after its start', () => {
    const week = defaultWeek();
    week[1] = [{ id: 'a', from: '18:00', to: '09:00' }];
    expect(validateDraft(draft({ week })).businessHours).toEqual({ code: 'badHours' });
  });

  it('flags an empty box and an overlap', () => {
    const empty = defaultWeek();
    empty[2] = [{ id: 'a', from: '', to: '10:00' }];
    expect(validateDraft(draft({ week: empty })).businessHours?.code).toBe('badHours');
    const overlap = defaultWeek();
    overlap[3] = [
      { id: 'a', from: '09:00', to: '12:00' },
      { id: 'b', from: '11:00', to: '14:00' },
    ];
    expect(validateDraft(draft({ week: overlap })).businessHours?.code).toBe('badHours');
  });

  it('allows a closed week but says so', () => {
    const d = draft({ week: emptyWeek() });
    expect(validateDraft(d).businessHours).toBeUndefined();
    expect(hasNoHours(d)).toBe(true);
    expect(hasNoHours(draft())).toBe(false);
  });

  it('allows two intervals in one day (a lunch break)', () => {
    const week = defaultWeek();
    week[1] = [
      { id: 'a', from: '09:00', to: '12:00' },
      { id: 'b', from: '13:00', to: '18:00' },
    ];
    expect(validateDraft(draft({ week })).businessHours).toBeUndefined();
    const rules = toInput(draft({ week })).businessHours.filter((r) => r.weekday === 1);
    expect(rules).toEqual([
      { weekday: 1, from: '09:00', to: '12:00' },
      { weekday: 1, from: '13:00', to: '18:00' },
    ]);
  });
});

describe('templates', () => {
  it('has a default for each event using only known placeholders', () => {
    for (const text of Object.values(DEFAULT_TEMPLATES)) {
      expect(text.trim()).not.toBe('');
      expect(unknownPlaceholders(text)).toEqual([]);
      expect(text.length).toBeLessThanOrEqual(TEMPLATE_MAX);
    }
    expect(Object.keys(DEFAULT_TEMPLATES).sort()).toEqual([
      'cancellation',
      'confirmation',
      'reminder',
      'reschedule',
    ]);
    expect(PLACEHOLDERS).toEqual(['{{type}}', '{{slot}}', '{{name}}', '{{manage_link}}']);
  });

  it('requires a body and caps its length', () => {
    const d = draft();
    expect(
      validateDraft({ ...d, templates: { ...d.templates, reminder: '  ' } })['templates.reminder'],
    ).toEqual({
      code: 'required',
    });
    expect(
      validateDraft({ ...d, templates: { ...d.templates, reminder: 'x'.repeat(TEMPLATE_MAX) } })[
        'templates.reminder'
      ],
    ).toBeUndefined();
    expect(
      validateDraft({
        ...d,
        templates: { ...d.templates, reminder: 'x'.repeat(TEMPLATE_MAX + 1) },
      })['templates.reminder'],
    ).toEqual({ code: 'tooLong', params: { max: TEMPLATE_MAX } });
  });

  it('lists placeholders nothing fills in, once each', () => {
    expect(unknownPlaceholders('Hi {{name}} {{service}} {{service}} {{ slot }} {{type}}')).toEqual([
      '{{service}}',
      '{{ slot }}',
    ]);
    expect(unknownPlaceholders('plain text')).toEqual([]);
  });

  it('knows when a body is the default', () => {
    expect(isDefaultTemplate('reminder', DEFAULT_TEMPLATES.reminder)).toBe(true);
    expect(isDefaultTemplate('reminder', `  ${DEFAULT_TEMPLATES.reminder}\n`)).toBe(true);
    expect(isDefaultTemplate('reminder', 'Something else')).toBe(false);
  });
});

describe('conversion', () => {
  it('round-trips a record to a draft and back to the API input', () => {
    const s = settings();
    expect(toInput(draftFromSettings(s, 'UTC'))).toEqual({
      timezone: 'Asia/Kolkata',
      slotDurationMinutes: 30,
      bufferBeforeMinutes: 5,
      bufferAfterMinutes: 10,
      maxPerDay: 16,
      advanceDays: 14,
      reminderMinutesBefore: 60,
      defaultLocation: '12 MG Road',
      businessHours: s.businessHours,
      templates: s.templates,
    });
  });

  it('sends numbers, not strings, and trims the text', () => {
    const d = draft({ defaultLocation: '  HQ  ' });
    d.numbers = { ...d.numbers, slotDurationMinutes: ' 45 ' };
    d.templates = { ...d.templates, reminder: '  See you  ' };
    const input = toInput(d);
    expect(input.slotDurationMinutes).toBe(45);
    expect(input.defaultLocation).toBe('HQ');
    expect(input.templates.reminder).toBe('See you');
  });

  it('drops unfinished hour rows and sorts the rest', () => {
    const week = emptyWeek();
    week[1] = [
      { id: 'b', from: '13:00', to: '17:00' },
      { id: 'a', from: '09:00', to: '12:00' },
      { id: 'c', from: '', to: '' },
    ];
    expect(toInput(draft({ week })).businessHours).toEqual([
      { weekday: 1, from: '09:00', to: '12:00' },
      { weekday: 1, from: '13:00', to: '17:00' },
    ]);
  });

  it('falls back to Reference defaults for a number that cannot be read (never reached after validation)', () => {
    expect(toInput(withNumber('maxPerDay', 'x')).maxPerDay).toBe(DEFAULT_NUMBERS.maxPerDay);
  });
});

describe('isDirty', () => {
  const base = draft();
  it('is false for an identical draft and for whitespace-only or blank-row changes', () => {
    expect(isDirty(base, draft())).toBe(false);
    expect(isDirty(base, { ...base, defaultLocation: '12 MG Road  ' })).toBe(false);
    const week = { ...base.week, 6: addInterval([]).map((iv) => ({ ...iv, from: '', to: '' })) };
    expect(isDirty(base, { ...base, week })).toBe(false);
  });

  it('is true for a changed value, hour, zone or template', () => {
    expect(isDirty(base, withNumber('maxPerDay', '17'))).toBe(true);
    expect(isDirty(base, withNumber('maxPerDay', 'abc'))).toBe(true);
    expect(isDirty(base, { ...base, timezone: 'UTC' })).toBe(true);
    expect(isDirty(base, { ...base, templates: { ...base.templates, reminder: 'x' } })).toBe(true);
    const week = { ...base.week, 6: [{ id: 'z', from: '10:00', to: '12:00' }] };
    expect(isDirty(base, { ...base, week })).toBe(true);
  });
});

describe('fieldKeyOf', () => {
  it('maps server paths onto form fields', () => {
    expect(fieldKeyOf('slotDurationMinutes')).toBe('slotDurationMinutes');
    expect(fieldKeyOf('businessHours.2.from')).toBe('businessHours');
    expect(fieldKeyOf('templates.reminder')).toBe('templates.reminder');
    expect(fieldKeyOf('timezone')).toBe('timezone');
    expect(fieldKeyOf('templates.other')).toBeNull();
    expect(fieldKeyOf('whatever')).toBeNull();
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  it('picks the largest fitting unit', () => {
    expect(relativeTime('2026-10-02T09:00:00Z', now, 'en')).toBe('3 hours ago');
    expect(relativeTime('2026-09-29T12:00:00Z', now, 'en')).toBe('3 days ago');
    expect(relativeTime('2026-10-01T12:00:00Z', now, 'en')).toBe('yesterday');
    expect(relativeTime('2026-10-02T11:59:30Z', now, 'en')).toBe('this minute');
  });
  it('is empty for nothing or garbage', () => {
    expect(relativeTime(null, now, 'en')).toBe('');
    expect(relativeTime('nope', now, 'en')).toBe('');
  });
});
