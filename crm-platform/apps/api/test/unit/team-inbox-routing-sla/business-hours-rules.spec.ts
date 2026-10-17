import { describe, expect, it } from 'vitest';
import { updateBusinessHoursSchema } from '@crm/contracts';
import {
  defaultBusinessHoursDays,
  mayEditTimezone,
  mergeBusinessHours,
  readBusinessHoursDays,
  sameDays,
} from '../../../src/modules/team-inbox-routing-sla/business-hours-rules';

describe('business hours defaults and reading', () => {
  it('defaults to Monday to Friday 09:00-18:00 with the weekend closed (Reference)', () => {
    const d = defaultBusinessHoursDays();
    expect(d.mon).toEqual({ enabled: true, from: '09:00', to: '18:00' });
    expect(d.fri.enabled).toBe(true);
    expect(d.sat.enabled).toBe(false);
    expect(d.sun.enabled).toBe(false);
  });

  it('shows the defaults when nothing is saved', () => {
    expect(readBusinessHoursDays(null)).toEqual(defaultBusinessHoursDays());
    expect(readBusinessHoursDays('')).toEqual(defaultBusinessHoursDays());
  });

  it('keeps a well-formed saved window and falls back per day for a malformed one', () => {
    const saved = JSON.stringify({
      days: {
        mon: { enabled: true, from: '08:30', to: '17:00' },
        tue: { enabled: false, from: '10:00', to: '10:00' }, // equal times
        wed: { enabled: true, from: '9:00', to: '18:00' }, // not HH:MM
      },
    });
    const d = readBusinessHoursDays(saved);
    expect(d.mon).toEqual({ enabled: true, from: '08:30', to: '17:00' });
    expect(d.tue).toEqual(defaultBusinessHoursDays().tue);
    expect(d.wed).toEqual(defaultBusinessHoursDays().wed);
    expect(d.thu).toEqual(defaultBusinessHoursDays().thu); // missing day
  });

  it('reads the schedule whether the column holds JSON text or an object', () => {
    const days = {
      ...defaultBusinessHoursDays(),
      mon: { enabled: false, from: '07:00', to: '12:00' },
    };
    expect(readBusinessHoursDays(JSON.stringify({ days }))).toEqual(days);
    expect(readBusinessHoursDays({ days })).toEqual(days);
  });
});

describe('who may change the time zone', () => {
  it('lets only the owner change it when the workspace names an owner', () => {
    expect(mayEditTimezone('owner-uuid', 'owner-uuid')).toBe(true);
    expect(mayEditTimezone('owner-uuid', 'admin-uuid')).toBe(false);
    expect(mayEditTimezone('owner-uuid', null)).toBe(false);
  });

  it('lets whoever may manage routing change it when no owner is named', () => {
    expect(mayEditTimezone(null, 'admin-uuid')).toBe(true);
  });
});

describe('saving the schedule', () => {
  it('replaces the days and keeps the other keys stored with the schedule', () => {
    const prior = JSON.stringify({
      days: defaultBusinessHoursDays(),
      outside_action: 'template',
      outside_template_id: 7,
      auto_reply_cooldown_min: 720,
    });
    const next = {
      ...defaultBusinessHoursDays(),
      sat: { enabled: true, from: '10:00', to: '14:00' },
    };
    const stored = JSON.parse(mergeBusinessHours(prior, next));
    expect(stored.days.sat).toEqual({ enabled: true, from: '10:00', to: '14:00' });
    expect(stored.outside_action).toBe('template');
    expect(stored.outside_template_id).toBe(7);
    expect(stored.auto_reply_cooldown_min).toBe(720);
  });

  it('starts a new JSON document when nothing was saved', () => {
    const stored = JSON.parse(mergeBusinessHours(null, defaultBusinessHoursDays()));
    expect(Object.keys(stored)).toEqual(['days']);
  });

  it('compares two schedules by their windows only', () => {
    const a = defaultBusinessHoursDays();
    expect(sameDays(a, defaultBusinessHoursDays())).toBe(true);
    expect(sameDays(a, { ...a, fri: { ...a.fri, to: '17:00' } })).toBe(false);
  });
});

describe('the request schema', () => {
  const days = defaultBusinessHoursDays();

  it('accepts seven windows with the zone', () => {
    expect(updateBusinessHoursSchema.safeParse({ timezone: 'Asia/Kolkata', days }).success).toBe(
      true,
    );
  });

  it('accepts a save without the zone (a non-owner)', () => {
    expect(updateBusinessHoursSchema.safeParse({ days }).success).toBe(true);
  });

  it('accepts an overnight window and refuses equal opening and closing times', () => {
    const night = { ...days, mon: { enabled: true, from: '18:00', to: '09:00' } };
    expect(updateBusinessHoursSchema.safeParse({ days: night }).success).toBe(true);
    const equal = { ...days, mon: { enabled: true, from: '09:00', to: '09:00' } };
    expect(updateBusinessHoursSchema.safeParse({ days: equal }).success).toBe(false);
  });

  it('refuses a missing day, a bad time and an unknown zone', () => {
    const { sun: _sun, ...noSunday } = days;
    expect(updateBusinessHoursSchema.safeParse({ days: noSunday }).success).toBe(false);
    expect(
      updateBusinessHoursSchema.safeParse({
        days: { ...days, tue: { enabled: true, from: '9am', to: '18:00' } },
      }).success,
    ).toBe(false);
    expect(updateBusinessHoursSchema.safeParse({ timezone: 'Mars/Olympus', days }).success).toBe(
      false,
    );
  });

  it('refuses keys it does not know', () => {
    expect(updateBusinessHoursSchema.safeParse({ days, outside_action: 'none' }).success).toBe(
      false,
    );
  });
});
