import { describe, expect, it } from 'vitest';
import { formFromTimers, queueProblems, sameForm, toQueueInput } from './queue-timers-form';

const OFF = {
  remindMinutes: null,
  overflowMinutes: null,
  overflowTeamId: null,
  unclaimedMinutes: null,
  unclaimedAction: 'keep' as const,
  unclaimedMessage: '',
};

describe('the waiting queue form', () => {
  it('everything off reads back as everything off and sends nulls', () => {
    const f = formFromTimers(OFF);
    expect([f.remind, f.overflow, f.final]).toEqual([false, false, false]);
    expect(toQueueInput(f)).toEqual(OFF);
    expect(queueProblems(f)).toEqual([]);
  });

  it('a stored step round-trips', () => {
    const stored = {
      remindMinutes: 5,
      overflowMinutes: 15,
      overflowTeamId: 'team-b',
      unclaimedMinutes: 40,
      unclaimedAction: 'message' as const,
      unclaimedMessage: 'Hi {{first_name}}',
    };
    expect(toQueueInput(formFromTimers(stored))).toEqual(stored);
  });

  it('switching a step off clears its minutes and companion in the request', () => {
    const f = formFromTimers({ ...OFF, overflowMinutes: 15, overflowTeamId: 'team-b', unclaimedMinutes: 40, unclaimedAction: 'bot' });
    const off = { ...f, overflow: false, final: false };
    expect(toQueueInput(off)).toEqual(OFF);
  });

  it('names what blocks a save', () => {
    const f = { ...formFromTimers(OFF), remind: true, remindMinutes: '0', overflow: true, final: true, finalMinutes: '2000' };
    expect(queueProblems(f).sort()).toEqual(['finalMessage', 'finalMinutes', 'overflowTeam', 'remindMinutes']);
    expect(queueProblems({ ...f, remindMinutes: '5', overflowTeamId: 't', finalMinutes: '60', finalAction: 'bot' })).toEqual([]);
  });

  it('knows when nothing changed', () => {
    const f = formFromTimers(OFF);
    expect(sameForm(f, { ...f, remindMinutes: '99' })).toBe(true); // a step that is off ignores its minutes
    expect(sameForm(f, { ...f, remind: true })).toBe(false);
  });
});
