import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { stageEntryValues, type StageState } from '../../../src/modules/crm/contacts/contact-stage';

const NOW = new Date('2026-10-05T10:00:00Z');
const fresh: StageState = { wonAt: null, lostAt: null, lostReason: null, otherLostReason: null };
const WON = { isWon: true, isLost: false };
const LOST = { isWon: false, isLost: true };
const PLAIN = { isWon: false, isLost: false };

describe('stageEntryValues', () => {
  it('a won stage stamps wonAt and clears the lost side', () => {
    const lost: StageState = { ...fresh, lostAt: new Date('2026-01-01'), lostReason: 'price' };
    expect(stageEntryValues({ flags: WON, current: lost, now: NOW })).toEqual({
      wonAt: NOW,
      lostAt: null,
      lostReason: null,
      otherLostReason: null,
    });
  });

  it('a lost stage stamps lostAt and records the reason it was given', () => {
    expect(
      stageEntryValues({ flags: LOST, current: fresh, lostReason: 'price', now: NOW }),
    ).toEqual({ lostAt: NOW, wonAt: null, lostReason: 'price' });
    expect(
      stageEntryValues({ flags: LOST, current: fresh, otherLostReason: 'moved abroad', now: NOW }),
    ).toEqual({ lostAt: NOW, wonAt: null, otherLostReason: 'moved abroad' });
  });

  it('a lost stage without any reason is 422 CON_LOST_REASON_REQUIRED, blank text included', () => {
    for (const reason of [undefined, null, '', '  ']) {
      try {
        stageEntryValues({ flags: LOST, current: fresh, lostReason: reason, now: NOW });
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as { code: string }).code).toBe(ERROR_CODES.CON_LOST_REASON_REQUIRED);
        expect((e as { getStatus(): number }).getStatus()).toBe(422);
      }
    }
  });

  it('a reason already on the contact satisfies the rule', () => {
    const had: StageState = { ...fresh, lostReason: 'price' };
    expect(stageEntryValues({ flags: LOST, current: had, now: NOW })).toEqual({
      lostAt: NOW,
      wonAt: null,
    });
  });

  it('an unflagged stage clears both stamps, and a reason that only described the loss', () => {
    const lost: StageState = { ...fresh, lostAt: new Date('2026-01-01'), lostReason: 'price' };
    expect(stageEntryValues({ flags: PLAIN, current: lost, now: NOW })).toEqual({
      wonAt: null,
      lostAt: null,
      lostReason: null,
      otherLostReason: null,
    });
    // A contact that was never lost keeps what a caller set by hand.
    const manual: StageState = { ...fresh, lostReason: 'manual' };
    expect(stageEntryValues({ flags: PLAIN, current: manual, now: NOW })).toEqual({
      wonAt: null,
      lostAt: null,
    });
  });

  it('a reason sent explicitly wins, even on an unflagged stage', () => {
    expect(
      stageEntryValues({ flags: PLAIN, current: fresh, lostReason: 'noted', now: NOW }),
    ).toEqual({ wonAt: null, lostAt: null, lostReason: 'noted' });
  });
});
