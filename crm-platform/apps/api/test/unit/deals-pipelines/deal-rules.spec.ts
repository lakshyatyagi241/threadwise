import { describe, expect, it } from 'vitest';
import {
  lostReasonAfter,
  stampsForKind,
  statusOfKind,
  statusTransition,
  winRatePercent,
} from '../../../src/modules/crm/deals/deal-rules';

const t0 = new Date('2026-10-01T10:00:00Z');
const t1 = new Date('2026-10-05T10:00:00Z');
const open = { status: 'open' as const, wonAt: null, lostAt: null };

describe('the deal state machine (WD-DEAL-008)', () => {
  it('WD-DEAL-008 #1: an open deal moved to a won stage is won, won_at is set, lost_at is null', () => {
    expect(stampsForKind('won', open, t0)).toEqual({ status: 'won', wonAt: t0, lostAt: null });
  });

  it('WD-DEAL-008 #1: a won deal moved to the won stage again keeps its original won_at', () => {
    const won = { status: 'won' as const, wonAt: t0, lostAt: null };
    expect(stampsForKind('won', won, t1).wonAt).toEqual(t0);
  });

  it('WD-DEAL-008 #2: a lost deal moved to an open stage is open with no stamps', () => {
    const lost = { status: 'lost' as const, wonAt: null, lostAt: t0 };
    expect(stampsForKind('open', lost, t1)).toEqual({ status: 'open', wonAt: null, lostAt: null });
  });

  it('WD-DEAL-008 #3: won -> lost clears won_at and stamps lost_at', () => {
    const won = { status: 'won' as const, wonAt: t0, lostAt: null };
    expect(stampsForKind('lost', won, t1)).toEqual({ status: 'lost', wonAt: null, lostAt: t1 });
  });

  it('WD-DEAL-008: a deal created straight into a lost stage is lost in the same step', () => {
    expect(stampsForKind('lost', null, t0)).toEqual({ status: 'lost', wonAt: null, lostAt: t0 });
    expect(statusOfKind('lost')).toBe('lost');
  });

  it('WD-DEAL-008 #4: the events a status change is worth: won, lost, reopened, and nothing for open -> open', () => {
    expect(statusTransition('open', 'won')).toBe('won');
    expect(statusTransition('won', 'lost')).toBe('lost');
    expect(statusTransition('lost', 'open')).toBe('reopened');
    expect(statusTransition('open', 'open')).toBeNull();
    expect(statusTransition('won', 'won')).toBeNull();
    // A new deal in an open stage is not a "reopen".
    expect(statusTransition(null, 'open')).toBeNull();
    expect(statusTransition(null, 'won')).toBe('won');
  });
});

describe('the lost reason a deal carries (WD-DEAL-012, 043)', () => {
  it('WD-DEAL-012 #2: a reason given with the move is kept on a lost deal', () => {
    expect(lostReasonAfter('lost', null, 'open', 'Budget')).toBe('Budget');
  });

  it('WD-DEAL-012: an already-lost deal keeps its reason when none is given', () => {
    expect(lostReasonAfter('lost', 'Budget', 'lost', null)).toBe('Budget');
    expect(lostReasonAfter('lost', 'Budget', 'open', null)).toBeNull();
  });

  it('WD-DEAL-008 #2 / port decision: a reopened or won deal drops the reason (WaDesk kept a stale one on won)', () => {
    expect(lostReasonAfter('open', 'Budget', 'lost', null)).toBeNull();
    expect(lostReasonAfter('won', 'Budget', 'lost', null)).toBeNull();
  });
});

describe('win rate (WD-DEAL-005 #2)', () => {
  it('WD-DEAL-005 #2: 2 won and 2 lost is 50; 3 won and 1 lost is 75', () => {
    expect(winRatePercent(2, 2)).toBe(50);
    expect(winRatePercent(3, 1)).toBe(75);
  });

  it('WD-DEAL-005 #3: no closed deals is 0, not NaN', () => {
    expect(winRatePercent(0, 0)).toBe(0);
  });

  it('WD-DEAL-005: rounds to a whole percent', () => {
    expect(winRatePercent(1, 2)).toBe(33);
    expect(winRatePercent(2, 1)).toBe(67);
  });
});
