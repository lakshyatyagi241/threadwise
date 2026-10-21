import { describe, expect, it } from 'vitest';
import {
  REPLY_PAYLOAD_MAX,
  REPLY_PREFIX,
  decideReply,
  openReplyToken,
  replyText,
  sealReplyToken,
  type ReplyFacts,
} from '../../../src/modules/appointments-booking/reminder-reply.rules';
import { maskEmail } from '../../../src/modules/appointments-booking/reminder-test-send';
import { rateOf } from '../../../src/modules/appointments-booking/reminder-report.service';
import {
  customerCancelCopy,
  testResultCopy,
} from '../../../src/modules/notifications/appointment-reply-notification.consumer';

// A stand-in for the real authenticated encryption: it only has to fail on anything it did not seal.
const seal = (plain: string) => Buffer.from(`sealed:${plain}`).toString('base64url');
const open = (cipher: string) => {
  const raw = Buffer.from(cipher, 'base64url').toString();
  if (!raw.startsWith('sealed:')) throw new Error('not sealed');
  return raw.slice('sealed:'.length);
};

const NOW = Date.parse('2026-11-09T10:00:00Z');
const START = Date.parse('2026-11-10T10:00:00Z');
const facts = (patch: Partial<ReplyFacts> = {}): ReplyFacts => ({
  action: 'confirm',
  sameContact: true,
  usedOutcome: null,
  status: 'confirmed',
  startsAtMs: START,
  nowMs: NOW,
  customerConfirmed: false,
  ...patch,
});

describe('the token on a button', () => {
  it('round-trips and stays inside the 256 characters WhatsApp allows for a payload', () => {
    const payload = sealReplyToken(seal, { o: 12, r: 3456789, a: 'cancel', n: 'AbCdEfGhIjKlMnOp' });
    expect(payload.startsWith(REPLY_PREFIX)).toBe(true);
    expect(payload.length).toBeLessThanOrEqual(REPLY_PAYLOAD_MAX);
    expect(openReplyToken(open, payload)).toEqual({
      o: 12,
      r: 3456789,
      a: 'cancel',
      n: 'AbCdEfGhIjKlMnOp',
    });
  });

  it('is refused when it is not ours, edited, or carries the wrong shape', () => {
    expect(openReplyToken(open, 'some other button')).toBeNull();
    expect(openReplyToken(open, `${REPLY_PREFIX}not-base64-json`)).toBeNull();
    const wrongAction = `${REPLY_PREFIX}${seal(JSON.stringify({ o: 1, r: 2, a: 'delete', n: 'x' }))}`;
    expect(openReplyToken(open, wrongAction)).toBeNull();
    const noNonce = `${REPLY_PREFIX}${seal(JSON.stringify({ o: 1, r: 2, a: 'confirm' }))}`;
    expect(openReplyToken(open, noNonce)).toBeNull();
  });
});

describe('what a tap does', () => {
  it("confirm records the customer's yes once", () => {
    expect(decideReply(facts())).toEqual({
      kind: 'act',
      outcome: 'confirmed',
      effect: 'confirm',
      remember: true,
    });
    expect(decideReply(facts({ customerConfirmed: true }))).toMatchObject({
      outcome: 'already_confirmed',
      effect: 'none',
    });
  });

  it('cancel cancels an upcoming booking, and says so when it was already cancelled', () => {
    expect(decideReply(facts({ action: 'cancel' }))).toEqual({
      kind: 'act',
      outcome: 'cancelled',
      effect: 'cancel',
      remember: true,
    });
    expect(decideReply(facts({ action: 'cancel', status: 'cancelled' }))).toMatchObject({
      outcome: 'already_cancelled',
      effect: 'none',
    });
    expect(decideReply(facts({ action: 'confirm', status: 'cancelled' }))).toMatchObject({
      outcome: 'not_available',
      effect: 'none',
    });
  });

  it('reschedule changes nothing and answers with the manage link', () => {
    expect(decideReply(facts({ action: 'reschedule' }))).toMatchObject({
      outcome: 'reschedule_link',
      effect: 'none',
    });
  });

  it('is idempotent: a button that was used is answered again and does nothing twice', () => {
    expect(decideReply(facts({ usedOutcome: 'confirmed' }))).toEqual({
      kind: 'repeat',
      outcome: 'confirmed',
    });
    expect(
      decideReply(facts({ action: 'cancel', usedOutcome: 'cancelled', status: 'cancelled' })),
    ).toEqual({ kind: 'repeat', outcome: 'cancelled' });
  });

  it('expires at the start: nothing changes at or after it', () => {
    expect(decideReply(facts({ nowMs: START }))).toMatchObject({
      outcome: 'expired',
      effect: 'none',
      remember: false,
    });
    expect(decideReply(facts({ nowMs: START + 60_000, action: 'cancel' }))).toMatchObject({
      outcome: 'expired',
      effect: 'none',
    });
  });

  it('is not replayable by someone else: a tap from another contact is ignored before anything is revealed', () => {
    expect(decideReply(facts({ sameContact: false }))).toEqual({ kind: 'ignore' });
    expect(decideReply(facts({ sameContact: false, usedOutcome: 'confirmed' }))).toEqual({
      kind: 'ignore',
    });
  });

  it('cannot change a booking that is over or closed', () => {
    for (const status of ['completed', 'no_show', 'declined'] as const) {
      expect(decideReply(facts({ status }))).toMatchObject({
        outcome: 'not_available',
        effect: 'none',
      });
    }
  });
});

describe('the words of the answer', () => {
  const v = { date: 'Tuesday 10 November', time: '10:00 AM', manageLink: 'https://x.test/m/1' };
  it('confirms the action in one sentence, English and Hindi', () => {
    expect(replyText('confirmed', 'en', v)).toBe(
      'Thank you, your appointment on Tuesday 10 November at 10:00 AM is confirmed.',
    );
    expect(replyText('cancelled', null, v)).toContain('has been cancelled');
    expect(replyText('confirmed', 'hi', v)).toMatch(/[ऀ-ॿ]/);
    expect(replyText('reschedule_link', 'en', v)).toContain('https://x.test/m/1');
    expect(replyText('reschedule_link', 'en', { ...v, manageLink: null })).not.toContain('http');
  });
});

describe('small helpers of the sequence', () => {
  it('masks the address of the email test', () => {
    expect(maskEmail('asha@example.com')).toBe('a***@example.com');
    expect(maskEmail('nope')).toBe('***');
  });
  it('a rate is null with nothing sent, never 0', () => {
    expect(rateOf(0, 0)).toBeNull();
    expect(rateOf(1, 3)).toBe(0.333);
    expect(rateOf(3, 3)).toBe(1);
  });
  it('words the two notes without any address or message', () => {
    expect(customerCancelCopy('2026-11-10T10:00:00Z').title).toBe(
      'A customer cancelled their appointment',
    );
    expect(testResultCopy('sent', null).title).toBe('Test email sent');
    expect(testResultCopy('skipped', 'channel_disabled').body).toContain('channel disabled');
  });
});
