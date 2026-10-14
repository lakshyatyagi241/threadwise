import { describe, expect, it } from 'vitest';
import { pickDelegate } from '../../../src/common/leave-delegate';
import {
  addDays,
  calendarDay,
  leaveCoversDay,
  resolveTimezone,
} from '../../../src/common/workspace-calendar';
import {
  checkChangedRange,
  checkNewRange,
  earlyEndDay,
  mayManage,
} from '../../../src/modules/workspaces-teams-tenancy/leave/leave-rules';
import { leaveStartedCopy } from '../../../src/modules/notifications/member-leave-notification.consumer';

describe('calendarDay: the workspace calendar, not the server clock', () => {
  it('the same instant is a different day in different zones', () => {
    const at = new Date('2026-10-13T10:30:00Z');
    expect(calendarDay(at, 'UTC')).toBe('2026-10-13');
    expect(calendarDay(at, 'Pacific/Kiritimati')).toBe('2026-10-14'); // UTC+14
    expect(calendarDay(at, 'Pacific/Pago_Pago')).toBe('2026-10-12'); // UTC-11
    expect(calendarDay(at, 'Asia/Kolkata')).toBe('2026-10-13'); // UTC+5:30
  });

  it('midnight is decided by the zone: 18:29 UTC is still the 13th in Kolkata, 18:30 UTC is the 14th', () => {
    expect(calendarDay(new Date('2026-10-13T18:29:59Z'), 'Asia/Kolkata')).toBe('2026-10-13');
    expect(calendarDay(new Date('2026-10-13T18:30:00Z'), 'Asia/Kolkata')).toBe('2026-10-14');
  });

  it('survives the spring-forward day (New York, 8 March 2026: 02:00 does not exist)', () => {
    expect(calendarDay(new Date('2026-03-08T06:59:59Z'), 'America/New_York')).toBe('2026-03-08'); // 01:59 EST
    expect(calendarDay(new Date('2026-03-08T07:00:00Z'), 'America/New_York')).toBe('2026-03-08'); // 03:00 EDT
    // the day before ends at 05:00 UTC (midnight EST), the day itself at 04:00 UTC the next day (midnight EDT)
    expect(calendarDay(new Date('2026-03-08T04:59:59Z'), 'America/New_York')).toBe('2026-03-07');
    expect(calendarDay(new Date('2026-03-09T03:59:59Z'), 'America/New_York')).toBe('2026-03-08');
    expect(calendarDay(new Date('2026-03-09T04:00:00Z'), 'America/New_York')).toBe('2026-03-09');
  });

  it('survives the fall-back day (New York, 1 November 2026: 01:30 happens twice)', () => {
    expect(calendarDay(new Date('2026-11-01T05:30:00Z'), 'America/New_York')).toBe('2026-11-01'); // 01:30 EDT
    expect(calendarDay(new Date('2026-11-01T06:30:00Z'), 'America/New_York')).toBe('2026-11-01'); // 01:30 EST
    expect(calendarDay(new Date('2026-11-02T04:59:59Z'), 'America/New_York')).toBe('2026-11-01');
    expect(calendarDay(new Date('2026-11-02T05:00:00Z'), 'America/New_York')).toBe('2026-11-02');
  });

  it('handles a zone with a half-hour daylight change (Lord Howe)', () => {
    // Lord Howe is UTC+10:30 in winter, UTC+11 in summer (DST from the first Sunday of October)
    expect(calendarDay(new Date('2026-10-03T13:29:00Z'), 'Australia/Lord_Howe')).toBe('2026-10-03');
    expect(calendarDay(new Date('2026-10-03T13:30:00Z'), 'Australia/Lord_Howe')).toBe('2026-10-04');
  });

  it('an unknown or empty zone is UTC, never an error', () => {
    expect(resolveTimezone('Mars/Olympus')).toBe('UTC');
    expect(resolveTimezone('')).toBe('UTC');
    expect(resolveTimezone(undefined)).toBe('UTC');
    expect(resolveTimezone('Europe/Berlin')).toBe('Europe/Berlin');
    expect(calendarDay(new Date('2026-10-13T23:59:00Z'), 'Mars/Olympus')).toBe('2026-10-13');
  });
});

describe('addDays: plain calendar arithmetic', () => {
  it('crosses months, years and leap days', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('a daylight change cannot move it (the day of the change has 23 or 25 hours)', () => {
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });
});

describe('leaveCoversDay', () => {
  const l = (startsOn: string, endsOn: string | null, status = 'active') => ({
    startsOn,
    endsOn,
    status,
  });

  it('both ends are inclusive: away on the first and the last day, back the day after', () => {
    const leave = l('2026-10-20', '2026-10-24');
    expect(leaveCoversDay(leave, '2026-10-19')).toBe(false);
    expect(leaveCoversDay(leave, '2026-10-20')).toBe(true);
    expect(leaveCoversDay(leave, '2026-10-24')).toBe(true);
    expect(leaveCoversDay(leave, '2026-10-25')).toBe(false);
  });

  it('a scheduled leave that has reached its day already counts (routing does not wait for the sweep)', () => {
    expect(leaveCoversDay(l('2026-10-20', '2026-10-24', 'scheduled'), '2026-10-21')).toBe(true);
  });

  it('an open-ended leave runs until somebody ends it', () => {
    expect(leaveCoversDay(l('2026-10-20', null), '2031-01-01')).toBe(true);
  });

  it('ended and cancelled leaves never count', () => {
    expect(leaveCoversDay(l('2026-10-20', '2026-10-24', 'ended'), '2026-10-21')).toBe(false);
    expect(leaveCoversDay(l('2026-10-20', '2026-10-24', 'cancelled'), '2026-10-21')).toBe(false);
  });
});

describe('leave ranges', () => {
  it('a new leave starts today or later and ends on or after its first day', () => {
    expect(checkNewRange('2026-10-13', '2026-10-13', null).ok).toBe(true);
    expect(checkNewRange('2026-10-13', '2026-10-13', '2026-10-13').ok).toBe(true); // a single day
    const past = checkNewRange('2026-10-13', '2026-10-12', null);
    expect(past).toMatchObject({ ok: false, path: 'startsOn' });
    const backwards = checkNewRange('2026-10-13', '2026-10-20', '2026-10-19');
    expect(backwards).toMatchObject({ ok: false, path: 'endsOn' });
  });

  it('a scheduled leave moves like a new one', () => {
    const cur = { status: 'scheduled', startsOn: '2026-10-20' };
    expect(checkChangedRange('2026-10-13', cur, { startsOn: '2026-10-15', endsOn: null }).ok).toBe(true);
    expect(checkChangedRange('2026-10-13', cur, { startsOn: '2026-10-01', endsOn: null }).ok).toBe(false);
  });

  it('an active leave keeps its first day and cannot end before today', () => {
    const cur = { status: 'active', startsOn: '2026-10-10' };
    expect(checkChangedRange('2026-10-13', cur, { startsOn: '2026-10-10', endsOn: '2026-10-30' }).ok).toBe(true);
    expect(checkChangedRange('2026-10-13', cur, { startsOn: '2026-10-10', endsOn: null }).ok).toBe(true);
    expect(checkChangedRange('2026-10-13', cur, { startsOn: '2026-10-11', endsOn: null })).toMatchObject({
      ok: false,
      path: 'startsOn',
    });
    expect(checkChangedRange('2026-10-13', cur, { startsOn: '2026-10-10', endsOn: '2026-10-12' })).toMatchObject({
      ok: false,
      path: 'endsOn',
    });
  });

  it('ended and cancelled leaves cannot be changed', () => {
    for (const status of ['ended', 'cancelled']) {
      expect(
        checkChangedRange('2026-10-13', { status, startsOn: '2026-10-01' }, { startsOn: '2026-10-01', endsOn: null }).ok,
      ).toBe(false);
    }
  });

  it('ending now: back today, so the last day away is yesterday', () => {
    expect(earlyEndDay('2026-10-13', '2026-10-01', '2026-10-30')).toBe('2026-10-12');
    expect(earlyEndDay('2026-10-13', '2026-10-01', null)).toBe('2026-10-12');
  });

  it('ending a leave that began today keeps its single day on record; ending one that was nearly over keeps its own end', () => {
    expect(earlyEndDay('2026-10-13', '2026-10-13', '2026-10-20')).toBe('2026-10-13');
    expect(earlyEndDay('2026-10-13', '2026-10-01', '2026-10-05')).toBe('2026-10-05');
  });
});

describe('who may manage whose leave', () => {
  it('own: only yourself; team: yourself and teammates; all: anyone; none: nobody', () => {
    expect(mayManage('own', 1, 1, false)).toBe(true);
    expect(mayManage('own', 1, 2, true)).toBe(false);
    expect(mayManage('team', 1, 2, true)).toBe(true);
    expect(mayManage('team', 1, 2, false)).toBe(false);
    expect(mayManage('team', 1, 1, false)).toBe(true);
    expect(mayManage('all', 1, 2, false)).toBe(true);
    expect(mayManage(null, 1, 1, true)).toBe(false);
  });
});

describe('pickDelegate: one hop, present and able', () => {
  const delegates = new Map([
    [1, 2],
    [2, 3],
    [3, 1], // a circle that slipped in (the API refuses it, a hand-edited row must still not loop)
  ]);

  it('the delegate stands in when present and eligible', () => {
    expect(pickDelegate(delegates, 1, () => false, () => true)).toBe(2);
  });

  it('a delegate who is away is skipped, and the chain is NOT followed (3 would be next)', () => {
    expect(pickDelegate(delegates, 1, (id) => id === 2, () => true)).toBeNull();
  });

  it('a delegate who cannot take the work is skipped', () => {
    expect(pickDelegate(delegates, 1, () => false, (id) => id !== 2)).toBeNull();
  });

  it('nobody named, or oneself, gives nobody', () => {
    expect(pickDelegate(delegates, 9, () => false, () => true)).toBeNull();
    expect(pickDelegate(new Map([[5, 5]]), 5, () => false, () => true)).toBeNull();
  });
});

describe('leaveStartedCopy', () => {
  it('names the person, the last day, what they hold and who covers', () => {
    const c = leaveStartedCopy({
      name: 'Asha',
      endsOn: '2026-10-24',
      ownedContacts: 120,
      openConversations: 3,
      delegateName: 'Ravi',
    });
    expect(c.title).toBe('Asha is on leave until 2026-10-24');
    expect(c.body).toContain('120 contacts and 3 open chats');
    expect(c.body).toContain('Ravi stands in');
  });

  it('says so when there is no delegate, with singular forms and open end', () => {
    const c = leaveStartedCopy({
      name: 'Asha',
      endsOn: null,
      ownedContacts: 1,
      openConversations: 1,
      delegateName: null,
    });
    expect(c.title).toBe('Asha is on leave');
    expect(c.body).toContain('1 contact and 1 open chat');
    expect(c.body).toContain('named no delegate');
  });

  it('a person who holds nothing says that', () => {
    expect(
      leaveStartedCopy({ name: 'A', endsOn: null, ownedContacts: 0, openConversations: 0, delegateName: null }).body,
    ).toContain('hold no contacts or open chats');
  });
});
