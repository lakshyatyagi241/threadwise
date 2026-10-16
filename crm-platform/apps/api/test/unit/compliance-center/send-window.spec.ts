import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_DEFAULTS,
  decideSendWindow,
  holdOf,
  isZone,
  policyOfSettings,
  resolveContactZones,
  zonesOfPhone,
  type SendWindowPolicy,
} from '@crm/contracts';

const policy = (over: Partial<SendWindowPolicy> = {}): SendWindowPolicy => ({
  quietHours: { start: '21:00', end: '09:00' },
  callingWindow: null,
  windowTimezone: null,
  workspaceTimezone: 'Asia/Kolkata',
  ...over,
});

const resolved = (zone: string, fallback = 'Asia/Kolkata') => ({
  zones: [zone],
  source: 'contact_field' as const,
  fallback: { zone: fallback, source: 'workspace' as const },
});
const at = (iso: string) => new Date(iso);

describe('policyOfSettings', () => {
  it('has no window when the switches are off (the default)', () => {
    const p = policyOfSettings(COMPLIANCE_DEFAULTS, 'Asia/Kolkata');
    expect(p.quietHours).toBeNull();
    expect(p.callingWindow).toBeNull();
    expect(p.workspaceTimezone).toBe('Asia/Kolkata');
  });

  it('keeps an enabled window and drops one that cannot work', () => {
    const p = policyOfSettings(
      {
        ...COMPLIANCE_DEFAULTS,
        quietHours: { enabled: true, start: '21:00', end: '08:00' },
        callingWindow: { enabled: true, start: '09:00', end: '17:00', days: [] },
        windowTimezone: 'Nowhere/Land',
      },
      'Not/AZone',
    );
    expect(p.quietHours).toEqual({ start: '21:00', end: '08:00' });
    expect(p.callingWindow).toBeNull();
    expect(p.windowTimezone).toBeNull();
    expect(p.workspaceTimezone).toBeNull();
  });
});

describe('decideSendWindow: messages and quiet hours', () => {
  const quiet = policy();

  it('allows a message in the open hours', () => {
    // 10:30 in India.
    expect(
      decideSendWindow('message', quiet, resolved('Asia/Kolkata'), at('2026-10-15T05:00:00Z')),
    ).toEqual({
      decision: 'allow',
    });
  });

  it('holds an evening message until the quiet hours end, on the contact clock', () => {
    // 21:30 in India: held until 09:00 the next morning (03:30 UTC).
    const d = decideSendWindow(
      'message',
      quiet,
      resolved('Asia/Kolkata'),
      at('2026-10-15T16:00:00Z'),
    );
    expect(d).toMatchObject({
      decision: 'hold',
      reason: 'quiet_hours',
      until: '2026-10-16T03:30:00.000Z',
      zone: 'Asia/Kolkata',
      zoneSource: 'contact_field',
    });
  });

  it('holds a small-hours message until the same morning (the window wraps midnight)', () => {
    // 00:30 in India on the 15th.
    const d = decideSendWindow(
      'message',
      quiet,
      resolved('Asia/Kolkata'),
      at('2026-10-14T19:00:00Z'),
    );
    expect(d).toMatchObject({ decision: 'hold', until: '2026-10-15T03:30:00.000Z' });
  });

  it('opens exactly at the end of the quiet hours, and holds a minute before', () => {
    expect(
      decideSendWindow('message', quiet, resolved('Asia/Kolkata'), at('2026-10-16T03:30:00Z'))
        .decision,
    ).toBe('allow');
    expect(
      decideSendWindow('message', quiet, resolved('Asia/Kolkata'), at('2026-10-16T03:29:00Z'))
        .decision,
    ).toBe('hold');
  });

  it('reads the hours on the contact clock: the same instant is open in New York, quiet in Kolkata', () => {
    const now = at('2026-10-15T16:00:00Z');
    expect(decideSendWindow('message', quiet, resolved('America/New_York'), now).decision).toBe(
      'allow',
    );
    expect(decideSendWindow('message', quiet, resolved('Asia/Kolkata'), now).decision).toBe('hold');
  });

  it('allows everything when no quiet hours are set', () => {
    const none = policy({ quietHours: null });
    expect(
      decideSendWindow('message', none, resolved('Asia/Kolkata'), at('2026-10-15T20:00:00Z')),
    ).toEqual({
      decision: 'allow',
    });
  });

  it('follows daylight saving: spring forward', () => {
    // New York, quiet 21:00 to 08:00. 2026-03-08 06:30 UTC is 01:30 EST; the clocks jump at 02:00, so 08:00 is EDT = 12:00 UTC.
    const us = policy({ quietHours: { start: '21:00', end: '08:00' } });
    const d = decideSendWindow(
      'message',
      us,
      resolved('America/New_York'),
      at('2026-03-08T06:30:00Z'),
    );
    expect(d).toMatchObject({ decision: 'hold', until: '2026-03-08T12:00:00.000Z' });
  });

  it('follows daylight saving: fall back', () => {
    // 2026-11-01 04:30 UTC is 00:30 EDT; the clocks go back at 02:00, so 08:00 is EST = 13:00 UTC.
    const us = policy({ quietHours: { start: '21:00', end: '08:00' } });
    const d = decideSendWindow(
      'message',
      us,
      resolved('America/New_York'),
      at('2026-11-01T04:30:00Z'),
    );
    expect(d).toMatchObject({ decision: 'hold', until: '2026-11-01T13:00:00.000Z' });
  });

  it('never holds a quiet hours end that is in the past', () => {
    for (const iso of [
      '2026-10-15T00:00:00Z',
      '2026-10-15T09:17:00Z',
      '2026-10-15T15:59:00Z',
      '2026-10-15T21:00:00Z',
    ]) {
      const now = at(iso);
      const d = decideSendWindow('message', quiet, resolved('Asia/Kolkata'), now);
      if (d.decision === 'hold') expect(new Date(d.until).getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe('decideSendWindow: calls and the calling window', () => {
  const calling = policy({
    quietHours: null,
    callingWindow: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
  });

  it('allows a call inside the window on a chosen day', () => {
    // Thursday 2026-10-15, 11:00 in India.
    expect(
      decideSendWindow('call', calling, resolved('Asia/Kolkata'), at('2026-10-15T05:30:00Z'))
        .decision,
    ).toBe('allow');
  });

  it('holds an after-hours call until the next morning', () => {
    // Thursday 18:30 in India: Friday 09:00.
    const d = decideSendWindow(
      'call',
      calling,
      resolved('Asia/Kolkata'),
      at('2026-10-15T13:00:00Z'),
    );
    expect(d).toMatchObject({
      decision: 'hold',
      reason: 'calling_window',
      until: '2026-10-16T03:30:00.000Z',
    });
  });

  it('holds a weekend call until Monday morning', () => {
    // Saturday 2026-10-17, 10:00 in India: Monday 2026-10-19 09:00.
    const d = decideSendWindow(
      'call',
      calling,
      resolved('Asia/Kolkata'),
      at('2026-10-17T04:30:00Z'),
    );
    expect(d).toMatchObject({ decision: 'hold', until: '2026-10-19T03:30:00.000Z' });
  });

  it('holds Friday evening until Monday', () => {
    const d = decideSendWindow(
      'call',
      calling,
      resolved('Asia/Kolkata'),
      at('2026-10-16T13:00:00Z'),
    );
    expect(d).toMatchObject({ decision: 'hold', until: '2026-10-19T03:30:00.000Z' });
  });

  it('ignores the quiet hours for a call and the calling window for a message', () => {
    const both = policy({
      quietHours: { start: '21:00', end: '09:00' },
      callingWindow: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
    });
    // Friday 20:00 India: outside the calling window, outside the quiet hours.
    const now = at('2026-10-16T14:30:00Z');
    expect(decideSendWindow('message', both, resolved('Asia/Kolkata'), now).decision).toBe('allow');
    expect(decideSendWindow('call', both, resolved('Asia/Kolkata'), now).decision).toBe('hold');
  });
});

describe('a country with several time zones', () => {
  const us = policy({
    quietHours: { start: '21:00', end: '08:00' },
    workspaceTimezone: 'Asia/Kolkata',
  });
  const usContact = resolveContactZones(us, { phone: '+14155550123' });

  it('lists every zone of the country when the contact has no zone of their own', () => {
    expect(usContact.source).toBe('phone_country');
    expect(usContact.zones).toContain('Pacific/Honolulu');
    expect(usContact.zones).toContain('America/New_York');
  });

  it('waits until the hours are right in every zone (the strictest reading)', () => {
    // 14:00 UTC is 10:00 in New York but 04:00 in Honolulu: held until Honolulu opens at 08:00 = 18:00 UTC.
    const d = decideSendWindow('message', us, usContact, at('2026-10-15T14:00:00Z'));
    expect(d).toMatchObject({
      decision: 'hold',
      until: '2026-10-15T18:00:00.000Z',
      zone: null,
      zoneSource: 'phone_country',
    });
  });

  it('allows when every zone is open', () => {
    expect(decideSendWindow('message', us, usContact, at('2026-10-15T19:00:00Z')).decision).toBe(
      'allow',
    );
  });

  it('falls back to the workspace clock when the zones leave no common moment', () => {
    // Open only 09:00 to 10:00 local: no hour is right in Honolulu and Halifax at once.
    const tight = policy({
      quietHours: { start: '10:00', end: '09:00' },
      workspaceTimezone: 'Asia/Kolkata',
    });
    const d = decideSendWindow(
      'message',
      tight,
      resolveContactZones(tight, { phone: '+14155550123' }),
      at('2026-10-15T14:00:00Z'),
    );
    expect(d.decision).toBe('hold');
    if (d.decision === 'hold') {
      expect(d.zoneSource).toBe('workspace');
      expect(d.zone).toBe('Asia/Kolkata');
    }
  });
});

describe('resolveContactZones: the documented fallback order', () => {
  const p = policy({ windowTimezone: 'Europe/London', workspaceTimezone: 'Asia/Kolkata' });

  it('1. the contact own time zone wins over the number', () => {
    const r = resolveContactZones(p, { timezone: 'Asia/Dubai', phone: '+919876543210' });
    expect(r).toMatchObject({ zones: ['Asia/Dubai'], source: 'contact_field' });
  });

  it('ignores a contact zone that is not an IANA zone', () => {
    const r = resolveContactZones(p, { timezone: 'India time', phone: '+919876543210' });
    expect(r).toMatchObject({ zones: ['Asia/Kolkata'], source: 'phone_country' });
  });

  it('2. reads the country code of the number', () => {
    expect(resolveContactZones(p, { phone: '919876543210' })).toMatchObject({
      zones: ['Asia/Kolkata'],
      source: 'phone_country',
    });
    expect(resolveContactZones(p, { phone: '+44 7700 900123' })).toMatchObject({
      zones: ['Europe/London'],
    });
  });

  it('3. then the zone chosen in the settings', () => {
    expect(resolveContactZones(p, { phone: '07700900123' })).toMatchObject({
      zones: ['Europe/London'],
      source: 'window_setting',
    });
  });

  it('4. then the workspace zone, 5. then UTC', () => {
    const ws = policy({ windowTimezone: null, workspaceTimezone: 'Asia/Kolkata' });
    expect(resolveContactZones(ws, {})).toMatchObject({
      zones: ['Asia/Kolkata'],
      source: 'workspace',
    });
    const none = policy({ windowTimezone: null, workspaceTimezone: null });
    expect(resolveContactZones(none, {})).toMatchObject({ zones: ['UTC'], source: 'utc' });
  });
});

describe('zonesOfPhone and isZone', () => {
  it('reads one zone for a one-zone country and several for a wide one', () => {
    expect(zonesOfPhone('+91 98765 43210')).toEqual(['Asia/Kolkata']);
    expect(zonesOfPhone('+4915112345678')).toEqual(['Europe/Berlin']);
    expect(zonesOfPhone('+5511912345678')!.length).toBeGreaterThan(1);
  });

  it('prefers the longest matching country code', () => {
    expect(zonesOfPhone('+971501234567')).toEqual(['Asia/Dubai']);
    expect(zonesOfPhone('+353851234567')).toEqual(['Europe/Dublin']);
  });

  it('refuses to guess for a number written locally or too short', () => {
    expect(zonesOfPhone('09876543210')).toBeNull();
    expect(zonesOfPhone('12345')).toBeNull();
    expect(zonesOfPhone(null)).toBeNull();
  });

  it('knows an IANA zone from a made-up one', () => {
    expect(isZone('Asia/Kolkata')).toBe(true);
    expect(isZone('Mars/Olympus')).toBe(false);
    expect(isZone('')).toBe(false);
    expect(isZone(null)).toBe(false);
  });
});

describe('holdOf', () => {
  it('is null for an allow and the stored shape for a hold', () => {
    expect(holdOf({ decision: 'allow' })).toBeNull();
    const d = decideSendWindow(
      'message',
      policy(),
      resolved('Asia/Kolkata'),
      at('2026-10-15T16:00:00Z'),
    );
    expect(holdOf(d)).toEqual({
      reason: 'quiet_hours',
      until: '2026-10-16T03:30:00.000Z',
      zone: 'Asia/Kolkata',
      zoneSource: 'contact_field',
    });
  });
});
