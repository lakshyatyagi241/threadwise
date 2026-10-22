import { describe, expect, it } from 'vitest';
import {
  dueSteps,
  longestPending,
  renderQueueMessage,
  waitedOpenMinutes,
  type TimerConfig,
  type TimerProgress,
} from '../../../src/modules/team-inbox-routing-sla/queue-timers';

const CFG: TimerConfig = {
  remindMinutes: 5,
  overflowMinutes: 10,
  overflowTeamId: 7,
  unclaimedMinutes: 20,
  unclaimedAction: 'message',
};
const NONE: TimerProgress = { remindedAt: null, offeredAt: null, finalAt: null };
const at = (s: string) => new Date(s);

// Mon-Fri 09:00-18:00 UTC, closed at the weekend.
const DAYS = {
  mon: { enabled: true, from: '09:00', to: '18:00' },
  tue: { enabled: true, from: '09:00', to: '18:00' },
  wed: { enabled: true, from: '09:00', to: '18:00' },
  thu: { enabled: true, from: '09:00', to: '18:00' },
  fri: { enabled: true, from: '09:00', to: '18:00' },
  sat: { enabled: false, from: '09:00', to: '18:00' },
  sun: { enabled: false, from: '09:00', to: '18:00' },
};

const WEEK = { days: DAYS };

describe('waitedOpenMinutes', () => {
  it('counts every minute for a chat with no team or a team without hours, capped at what is needed', () => {
    const since = at('2026-10-21T10:00:00Z');
    const now = at('2026-10-21T10:30:00Z');
    expect(waitedOpenMinutes(since, now, null, 100)).toBe(30);
    expect(waitedOpenMinutes(since, now, { hours: null, timezone: null }, 20)).toBe(20);
    expect(waitedOpenMinutes(now, since, null, 100)).toBe(0);
  });

  it('counts only the minutes the team is open: a Friday evening arrival has not waited on Monday morning', () => {
    const team = { hours: WEEK, timezone: 'UTC' };
    // arrives Friday 17:50, checked Monday 09:05: 10 open minutes on Friday + 5 on Monday
    expect(
      waitedOpenMinutes(at('2026-10-23T17:50:00Z'), at('2026-10-26T09:05:00Z'), team, 1000),
    ).toBe(15);
    // arrives Saturday, checked Saturday evening: nothing
    expect(
      waitedOpenMinutes(at('2026-10-24T10:00:00Z'), at('2026-10-24T20:00:00Z'), team, 1000),
    ).toBe(0);
  });

  it('uses the team time zone', () => {
    const team = { hours: WEEK, timezone: 'Asia/Kolkata' }; // 09:00 IST = 03:30 UTC
    expect(
      waitedOpenMinutes(at('2026-10-21T03:00:00Z'), at('2026-10-21T04:00:00Z'), team, 1000),
    ).toBe(30);
  });
});

describe('dueSteps', () => {
  it('runs the steps in order as their minutes are reached, each only once', () => {
    expect(dueSteps(CFG, NONE, 4)).toEqual([]);
    expect(dueSteps(CFG, NONE, 5)).toEqual(['remind']);
    expect(dueSteps(CFG, NONE, 12)).toEqual(['remind', 'offer']);
    expect(dueSteps(CFG, NONE, 25)).toEqual(['remind', 'offer', 'final']);
    expect(dueSteps(CFG, { ...NONE, remindedAt: new Date() }, 12)).toEqual(['offer']);
    expect(
      dueSteps(CFG, { remindedAt: new Date(), offeredAt: new Date(), finalAt: new Date() }, 999),
    ).toEqual([]);
  });

  it('a step that is off, or lacks its companion, never runs', () => {
    expect(dueSteps({ ...CFG, remindMinutes: null }, NONE, 999)).toEqual(['offer', 'final']);
    expect(dueSteps({ ...CFG, overflowTeamId: null }, NONE, 999)).toEqual(['remind', 'final']);
    expect(dueSteps({ ...CFG, unclaimedAction: 'keep' }, NONE, 999)).toEqual(['remind', 'offer']);
  });

  it('longestPending is the walk length that decides every pending step', () => {
    expect(longestPending(CFG, NONE)).toBe(20);
    expect(longestPending(CFG, { ...NONE, finalAt: new Date() })).toBe(10);
    expect(longestPending({ ...CFG, unclaimedAction: 'keep' }, NONE)).toBe(10);
    expect(
      longestPending(
        { ...CFG, remindMinutes: null, overflowMinutes: null, unclaimedMinutes: null },
        NONE,
      ),
    ).toBe(0);
  });
});

describe('renderQueueMessage', () => {
  it('fills the known variables, drops unknown ones, trims', () => {
    expect(
      renderQueueMessage('Hi {{first_name}}, {{ name }}! {{nope}}', {
        first_name: 'Asha',
        name: 'Asha Rao',
      }),
    ).toBe('Hi Asha, Asha Rao!');
  });
});
