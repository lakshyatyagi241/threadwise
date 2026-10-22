import { describe, expect, it } from 'vitest';
import {
  EMPTY_SEND,
  botLineKeys,
  giveBackToastKey,
  sendReady,
  toSendInput,
  waitAge,
} from './handoff';
import { tabCount } from './list';

const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

describe('waitAge', () => {
  it('counts minutes up to an hour, then hours up to two days, then days', () => {
    expect(waitAge(ago(0), NOW)).toEqual({ count: 0, unit: 'm' });
    expect(waitAge(ago(59 * MIN), NOW)).toEqual({ count: 59, unit: 'm' });
    expect(waitAge(ago(60 * MIN), NOW)).toEqual({ count: 1, unit: 'h' });
    expect(waitAge(ago(47 * 60 * MIN), NOW)).toEqual({ count: 47, unit: 'h' });
    expect(waitAge(ago(48 * 60 * MIN), NOW)).toEqual({ count: 2, unit: 'd' });
  });

  it('never goes negative (a clock a little behind the server) or fails on a bad date', () => {
    expect(waitAge(ago(-5 * MIN), NOW)).toEqual({ count: 0, unit: 'm' });
    expect(waitAge('not a date', NOW)).toEqual({ count: 0, unit: 'm' });
  });
});

describe('the send-to-queue draft', () => {
  it('is ready as the assignment rules, and needs a team or a person for the other two', () => {
    expect(sendReady(EMPTY_SEND)).toBe(true);
    expect(sendReady({ ...EMPTY_SEND, kind: 'team' })).toBe(false);
    expect(sendReady({ ...EMPTY_SEND, kind: 'team', teamId: 't1' })).toBe(true);
    expect(sendReady({ ...EMPTY_SEND, kind: 'person' })).toBe(false);
    expect(sendReady({ ...EMPTY_SEND, kind: 'person', userId: 'u1' })).toBe(true);
  });

  it('becomes the request the API takes, with the note trimmed and left out when empty', () => {
    expect(toSendInput(EMPTY_SEND)).toEqual({ reason: 'other', destination: { kind: 'rules' } });
    expect(
      toSendInput({
        kind: 'team',
        teamId: 't1',
        userId: '',
        reason: 'complaint',
        note: '  refund asked  ',
      }),
    ).toEqual({
      reason: 'complaint',
      reasonText: 'refund asked',
      destination: { kind: 'team', teamId: 't1' },
    });
    expect(toSendInput({ ...EMPTY_SEND, kind: 'person', userId: 'u1' }).destination).toEqual({
      kind: 'person',
      userId: 'u1',
    });
  });
});

describe('the Waiting tab badge', () => {
  const counts = { all: 5, mine: 1, unassigned: 2, unread: 3, archived: 0 };
  it('reads 0 from an older server that does not send the count yet, and null before the first answer', () => {
    expect(tabCount({ ...counts }, 'waiting')).toBe(0);
    expect(tabCount({ ...counts, waiting: 4 }, 'waiting')).toBe(4);
    expect(tabCount(null, 'waiting')).toBeNull();
  });
});

describe('Return to bot says what the bot will do', () => {
  const r = (over: Partial<Parameters<typeof giveBackToastKey>[0]>) =>
    giveBackToastKey({
      resumed: 'next_message',
      nextMessageBy: 'default_flow',
      alreadyWithBot: false,
      ...over,
    });

  it('picks the toast from the answer, never a bare "done"', () => {
    expect(r({ resumed: 'flow', nextMessageBy: null })).toBe('doneFlow');
    expect(r({ nextMessageBy: 'live_flow' })).toBe('doneNextLive');
    expect(r({ nextMessageBy: 'default_flow' })).toBe('doneNextDefault');
    expect(r({ alreadyWithBot: true })).toBe('already');
  });

  it('words the thread line from the event: the press, then the result and the customer message', () => {
    expect(botLineKeys({ event: 'bot_returned', stage: 'pressed', resumed: 'flow' })).toEqual([
      'pressed.flow',
    ]);
    expect(
      botLineKeys({
        event: 'bot_returned',
        stage: 'pressed',
        resumed: 'next_message',
        nextMessageBy: 'live_flow',
      }),
    ).toEqual(['pressed.nextLive']);
    expect(
      botLineKeys({ event: 'bot_returned', stage: 'pressed', resumed: 'next_message' }),
    ).toEqual(['pressed.nextDefault']);
    expect(
      botLineKeys({
        event: 'bot_returned',
        stage: 'result',
        result: 'continued',
        customer: 'window_closed',
      }),
    ).toEqual(['result.continued', 'customer.window_closed']);
    expect(
      botLineKeys({ event: 'bot_returned', stage: 'result', result: 'claimed_again' }),
    ).toEqual(['result.claimed_again']);
  });
});
