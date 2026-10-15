import { describe, expect, it } from 'vitest';
import type { MemberLeave } from '@crm/contracts';
import { addDays, daysBetween, formatDay, leaveBadge, returnDay, validateLeave } from './leave';

const leave = (over: Partial<MemberLeave>): MemberLeave => ({
  id: 'l1',
  memberId: 'm1',
  memberName: 'Asha',
  startsOn: '2026-10-20',
  endsOn: '2026-10-24',
  reason: null,
  status: 'scheduled',
  onLeaveNow: false,
  startedAt: null,
  endedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  rowVersion: 1,
  ...over,
});

describe('formatDay', () => {
  it('is the same calendar day in every language and never shifts with the browser zone', () => {
    expect(formatDay('2026-03-08', 'en')).toBe('Mar 8');
    expect(formatDay('2026-11-01', 'en')).toBe('Nov 1');
    expect(formatDay('2026-01-01', 'en', true)).toBe('Jan 1, 2026');
    expect(formatDay('2026-10-20', 'de')).toContain('20');
    expect(/[٠-٩0-9]/.test(formatDay('2026-10-20', 'ar'))).toBe(true);
  });
});

describe('calendar arithmetic', () => {
  it('adds days across months, years and leap days', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09'); // the day a clock changes still has one next day
    expect(daysBetween('2026-10-13', '2026-10-27')).toBe(14);
    expect(daysBetween('2026-10-27', '2026-10-13')).toBe(-14);
  });

  it('the return day is the day after the last day away; none for an open-ended leave', () => {
    expect(returnDay({ endsOn: '2026-10-24' })).toBe('2026-10-25');
    expect(returnDay({ endsOn: '2026-12-31' })).toBe('2027-01-01');
    expect(returnDay({ endsOn: null })).toBeNull();
    expect(returnDay(null)).toBeNull();
  });
});

describe('leaveBadge', () => {
  const today = '2026-10-13';
  it('away now wins, with the last day', () => {
    expect(leaveBadge([leave({ onLeaveNow: true, status: 'active' })], 'm1', today)).toEqual({
      kind: 'now',
      until: '2026-10-24',
    });
    expect(
      leaveBadge([leave({ onLeaveNow: true, status: 'active', endsOn: null })], 'm1', today),
    ).toEqual({ kind: 'now', until: null });
  });

  it('a leave starting within two weeks is announced, a later one is not', () => {
    expect(leaveBadge([leave({ startsOn: '2026-10-27' })], 'm1', today)).toEqual({
      kind: 'soon',
      from: '2026-10-27',
    });
    expect(leaveBadge([leave({ startsOn: '2026-10-28' })], 'm1', today)).toBeNull();
  });

  it('only the member own leave counts, and the nearest upcoming one is chosen', () => {
    const others = [leave({ memberId: 'm2', onLeaveNow: true, status: 'active' })];
    expect(leaveBadge(others, 'm1', today)).toBeNull();
    const two = [
      leave({ id: 'a', startsOn: '2026-10-25' }),
      leave({ id: 'b', startsOn: '2026-10-20' }),
    ];
    expect(leaveBadge(two, 'm1', today)).toEqual({ kind: 'soon', from: '2026-10-20' });
  });
});

describe('validateLeave', () => {
  const today = '2026-10-13';
  const base = { startsOn: '2026-10-20', endsOn: '2026-10-24', openEnded: false, reason: '  ' };
  it('accepts a range, trims the reason to null, and keeps an open end', () => {
    expect(validateLeave(base, today)).toEqual({
      ok: true,
      input: { startsOn: '2026-10-20', endsOn: '2026-10-24', reason: null },
    });
    expect(
      validateLeave({ ...base, openEnded: true, endsOn: '', reason: ' sick ' }, today),
    ).toEqual({ ok: true, input: { startsOn: '2026-10-20', endsOn: null, reason: 'sick' } });
    expect(validateLeave({ ...base, startsOn: today, endsOn: today }, today).ok).toBe(true);
  });
  it('names the first problem', () => {
    expect(validateLeave({ ...base, startsOn: '' }, today)).toEqual({
      ok: false,
      problem: 'startRequired',
    });
    expect(validateLeave({ ...base, startsOn: '2026-10-12' }, today)).toEqual({
      ok: false,
      problem: 'startPast',
    });
    expect(validateLeave({ ...base, endsOn: '' }, today)).toEqual({
      ok: false,
      problem: 'endRequired',
    });
    expect(validateLeave({ ...base, endsOn: '2026-10-19' }, today)).toEqual({
      ok: false,
      problem: 'endBeforeStart',
    });
  });
});
