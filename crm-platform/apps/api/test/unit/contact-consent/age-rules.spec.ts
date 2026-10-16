import { describe, expect, it } from 'vitest';
import {
  addYears,
  ageOnDay,
  birthDateSchema,
  earliestToday,
  gateMinAge,
  isPlausibleBirthDate,
  isUnderAge,
  judgeAgeAnswer,
  latestToday,
  minorBornAfter,
  minorUntilForAge,
  minorUntilForBirth,
  parseAgeAnswer,
  parseIsoDay,
  subYears,
  workspaceMinorAge,
  ageGateSchema,
} from '@crm/contracts';
import {
  NO_FLAGS,
  planFlagChange,
  type FlagsState,
} from '../../../src/modules/contact-consent/contact-privacy.rules';

const NOW = new Date('2026-10-16T10:00:00.000Z');

describe('the calendar day used for age checks', () => {
  it('is the earliest date on Earth (UTC minus 12 hours) for "today" and the latest (plus 14) for the future', () => {
    expect(earliestToday(new Date('2026-10-16T11:59:00Z'))).toBe('2026-10-15');
    expect(earliestToday(new Date('2026-10-16T12:00:00Z'))).toBe('2026-10-16');
    expect(latestToday(new Date('2026-10-16T09:59:00Z'))).toBe('2026-10-16');
    expect(latestToday(new Date('2026-10-16T10:00:00Z'))).toBe('2026-10-17');
  });

  it('parses only real ISO days', () => {
    expect(parseIsoDay('2010-02-28')).toEqual({ y: 2010, m: 2, d: 28 });
    expect(parseIsoDay('2010-02-29')).toBeNull();
    expect(parseIsoDay('2012-02-29')).toEqual({ y: 2012, m: 2, d: 29 });
    expect(parseIsoDay('2010-2-3')).toBeNull();
    expect(parseIsoDay('10/02/2010')).toBeNull();
    expect(parseIsoDay(20100228)).toBeNull();
  });
});

describe('whole years between two days', () => {
  it('counts the birthday on its own day', () => {
    expect(ageOnDay('2008-10-16', '2026-10-15')).toBe(17);
    expect(ageOnDay('2008-10-16', '2026-10-16')).toBe(18);
    expect(ageOnDay('2008-10-17', '2026-10-16')).toBe(17);
    expect(ageOnDay('2008-12-31', '2026-01-01')).toBe(17);
  });

  it('moves a 29 February birthday to 1 March in a common year', () => {
    expect(addYears('2008-02-29', 18)).toBe('2026-03-01');
    expect(addYears('2008-02-29', 16)).toBe('2024-02-29');
    expect(addYears('2008-03-01', 18)).toBe('2026-03-01');
    expect(subYears('2028-02-29', 18)).toBe('2010-02-28');
    expect(subYears('2028-02-29', 16)).toBe('2012-02-29');
  });
});

describe('isUnderAge and the SQL cut-off say the same for every day', () => {
  it('agrees across a window of birth days, including leap days', () => {
    for (const min of [13, 16, 18, 21]) {
      const cut = minorBornAfter(min, NOW);
      for (let offset = -400; offset <= 400; offset += 1) {
        const born = new Date(Date.UTC(2026 - min, 9, 16) + offset * 86_400_000)
          .toISOString()
          .slice(0, 10);
        expect(born > cut, `${born} for ${min}`).toBe(isUnderAge(born, min, NOW));
      }
    }
    const leapNow = new Date('2028-02-29T15:00:00Z');
    const cut = minorBornAfter(18, leapNow);
    expect(cut).toBe('2010-02-28');
    expect(isUnderAge('2010-02-28', 18, leapNow)).toBe(false);
    expect(isUnderAge('2010-03-01', 18, leapNow)).toBe(true);
  });

  it('keeps a minor flagged on the birthday until it has started everywhere', () => {
    // 2026-10-16 10:00 UTC: Baker Island is still on the 15th, so someone born 2008-10-16 is not yet 18 for us.
    expect(isUnderAge('2008-10-16', 18, new Date('2026-10-16T10:00:00Z'))).toBe(true);
    expect(isUnderAge('2008-10-16', 18, new Date('2026-10-16T12:00:00Z'))).toBe(false);
  });
});

describe('plausible birth dates', () => {
  it('refuses the future, before 1900 and more than 120 years ago', () => {
    expect(isPlausibleBirthDate('2026-10-16', NOW)).toBe(true);
    expect(isPlausibleBirthDate('2026-10-17', NOW)).toBe(true); // already the 17th in UTC+14
    expect(isPlausibleBirthDate('2026-10-18', NOW)).toBe(false);
    expect(isPlausibleBirthDate('1899-12-31', NOW)).toBe(false);
    expect(isPlausibleBirthDate('1900-01-01', NOW)).toBe(false); // 126 years
    expect(isPlausibleBirthDate('1950-05-05', NOW)).toBe(true);
    expect(isPlausibleBirthDate('not a date', NOW)).toBe(false);
    expect(birthDateSchema.safeParse('2010-13-01').success).toBe(false);
    expect(birthDateSchema.safeParse('2010-12-01').success).toBe(true);
  });
});

describe('age answers', () => {
  it('accepts a whole number from 0 to 120', () => {
    expect(parseAgeAnswer('17')).toBe(17);
    expect(parseAgeAnswer(' 17 ')).toBe(17);
    expect(parseAgeAnswer(17)).toBe(17);
    expect(parseAgeAnswer('0')).toBe(0);
    expect(parseAgeAnswer('120')).toBe(120);
    expect(parseAgeAnswer('121')).toBeNull();
    expect(parseAgeAnswer('17.5')).toBeNull();
    expect(parseAgeAnswer('-1')).toBeNull();
    expect(parseAgeAnswer('seventeen')).toBeNull();
    expect(parseAgeAnswer('1e1')).toBeNull();
    expect(parseAgeAnswer('')).toBeNull();
    expect(parseAgeAnswer(null)).toBeNull();
  });

  it('keeps the flag of a bare age until the person is certainly of age', () => {
    // Says 12 today, the line is 16: 12 may be 12 years and 364 days, so 16 is reached at the latest in 4 years.
    expect(minorUntilForAge(12, 16, NOW)).toBe('2030-10-15');
    expect(minorUntilForAge(15, 16, NOW)).toBe('2027-10-15');
  });
});

describe('judging an answer', () => {
  it('date of birth: adult, under with the birthday as expiry, or invalid', () => {
    expect(judgeAgeAnswer({ mode: 'dob', dob: '2000-01-01' }, 18, NOW)).toEqual({
      kind: 'adult',
      mode: 'dob',
      minAge: 18,
      dob: '2000-01-01',
    });
    expect(judgeAgeAnswer({ mode: 'dob', dob: '2012-06-01' }, 16, NOW)).toEqual({
      kind: 'under',
      mode: 'dob',
      minAge: 16,
      dob: '2012-06-01',
      minorUntil: '2028-06-01',
    });
    expect(judgeAgeAnswer({ mode: 'dob', dob: '2999-01-01' }, 18, NOW)).toEqual({
      kind: 'invalid',
    });
    expect(judgeAgeAnswer({ mode: 'dob' }, 18, NOW)).toEqual({ kind: 'invalid' });
  });

  it('age: under below the line, adult at it, invalid when not a number', () => {
    expect(judgeAgeAnswer({ mode: 'age', age: '17' }, 18, NOW)).toMatchObject({ kind: 'under' });
    expect(judgeAgeAnswer({ mode: 'age', age: 18 }, 18, NOW)).toMatchObject({ kind: 'adult' });
    expect(judgeAgeAnswer({ mode: 'age', age: 'x' }, 18, NOW)).toEqual({ kind: 'invalid' });
  });

  it('declaration: only a ticked box is an adult; an unticked one never lapses by itself', () => {
    expect(judgeAgeAnswer({ mode: 'declaration', confirmed: true }, 16, NOW)).toMatchObject({
      kind: 'adult',
    });
    expect(judgeAgeAnswer({ mode: 'declaration', confirmed: false }, 16, NOW)).toEqual({
      kind: 'under',
      mode: 'declaration',
      minAge: 16,
      minorUntil: null,
    });
    expect(judgeAgeAnswer({ mode: 'declaration' }, 16, NOW)).toMatchObject({ kind: 'under' });
    // Only the boolean true counts: the string "true" from a bad client is not a ticked box.
    expect(judgeAgeAnswer({ mode: 'declaration', confirmed: 'true' }, 16, NOW)).toMatchObject({
      kind: 'under',
    });
  });

  it('minorUntilForBirth is the birthday of the line', () => {
    expect(minorUntilForBirth('2008-02-29', 18)).toBe('2026-03-01');
  });
});

describe('the gate and the workspace age', () => {
  it('uses the gate age when set, else the workspace age', () => {
    expect(gateMinAge({ minAge: 21 }, 18)).toBe(21);
    expect(gateMinAge({ minAge: null }, 16)).toBe(16);
  });

  it('is the highest age of the switched-on profiles, else 18', () => {
    expect(workspaceMinorAge([])).toBe(18);
    expect(workspaceMinorAge(['generic'])).toBe(18);
    expect(workspaceMinorAge(['gdpr_eu'])).toBe(16);
    expect(workspaceMinorAge(['ccpa_us'])).toBeGreaterThanOrEqual(13);
    expect(workspaceMinorAge(['gdpr_eu', 'dpdp_in'])).toBe(18);
  });

  it('defaults to off, declaration and block; refuses an age outside 1 to 21', () => {
    expect(ageGateSchema.parse({})).toEqual({
      enabled: false,
      mode: 'declaration',
      minAge: null,
      whenUnder: 'block',
    });
    expect(ageGateSchema.safeParse({ minAge: 0 }).success).toBe(false);
    expect(ageGateSchema.safeParse({ minAge: 22 }).success).toBe(false);
    expect(ageGateSchema.safeParse({ unknown: 1 }).success).toBe(false);
  });
});

describe('planFlagChange and the system source', () => {
  const dobOn = (until: string | null): FlagsState => ({
    ...NO_FLAGS,
    isMinor: true,
    minorSince: NOW.toISOString(),
    minorSource: 'dob',
    minorUntil: until,
  });

  it('flags from a date of birth with its expiry, and lifts it again', () => {
    const on = planFlagChange(NO_FLAGS, 'minor', true, 'dob', NOW, { minorUntil: '2028-06-01' });
    if (!on.ok) throw new Error('unreachable');
    expect(on.next).toMatchObject({ isMinor: true, minorSource: 'dob', minorUntil: '2028-06-01' });
    const off = planFlagChange(on.next, 'minor', false, 'dob', NOW);
    if (!off.ok) throw new Error('unreachable');
    expect(off.next).toMatchObject({ isMinor: false, minorSource: null, minorUntil: null });
  });

  it('refreshes the expiry of its own flag without a second "changed"', () => {
    const again = planFlagChange(dobOn('2028-06-01'), 'minor', true, 'dob', NOW, {
      minorUntil: '2027-06-01',
    });
    if (!again.ok) throw new Error('unreachable');
    expect(again.changed).toBe(false);
    expect(again.next.minorUntil).toBe('2027-06-01');
  });

  it('never overrules a person: dob can neither clear nor take over a manual flag', () => {
    const manual: FlagsState = { ...NO_FLAGS, isMinor: true, minorSource: 'manual' };
    expect(planFlagChange(manual, 'minor', false, 'dob', NOW)).toEqual({
      ok: false,
      reason: 'person_flag',
    });
    expect(planFlagChange(manual, 'minor', true, 'dob', NOW, { minorUntil: '2030-01-01' })).toEqual(
      {
        ok: false,
        reason: 'person_flag',
      },
    );
  });

  it('a person flagging an already dob-flagged contact takes it over and it stops lapsing', () => {
    const taken = planFlagChange(dobOn('2028-06-01'), 'minor', true, 'manual', NOW);
    if (!taken.ok) throw new Error('unreachable');
    expect(taken.changed).toBe(false);
    expect(taken.next).toMatchObject({ minorSource: 'manual', minorUntil: null });
  });

  it('a person clearing while the date still says minor leaves a note for the sweep', () => {
    const cleared = planFlagChange(dobOn('2028-06-01'), 'minor', false, 'manual', NOW, {
      dobSaysMinorFor: '2012-06-01',
    });
    if (!cleared.ok) throw new Error('unreachable');
    expect(cleared.next).toMatchObject({ isMinor: false, dobOverrideFor: '2012-06-01' });
    // The sweep itself clearing leaves no such note, and flagging again drops it.
    const swept = planFlagChange(dobOn('2026-06-01'), 'minor', false, 'dob', NOW, {
      dobSaysMinorFor: '2012-06-01',
    });
    if (!swept.ok) throw new Error('unreachable');
    expect(swept.next.dobOverrideFor).toBeNull();
    const reflag = planFlagChange(cleared.next, 'minor', true, 'manual', NOW);
    if (!reflag.ok) throw new Error('unreachable');
    expect(reflag.next.dobOverrideFor).toBeNull();
  });

  it('a declaration flag never lapses by itself', () => {
    const d = planFlagChange(NO_FLAGS, 'minor', true, 'declaration', NOW, {
      minorUntil: '2030-01-01',
    });
    if (!d.ok) throw new Error('unreachable');
    expect(d.next).toMatchObject({ minorSource: 'declaration', minorUntil: null });
  });
});
