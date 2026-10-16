import { describe, expect, it } from 'vitest';
import type { PreviousSendOption, PreviousSendsAudience } from '@crm/contracts';
import { uuid } from '../wizard/testing';
import {
  EMPTY_PREVIOUS,
  hasPrevious,
  outcomeBlocked,
  outcomeCount,
  previousEstimate,
  previousNames,
  sanitizePrevious,
  tickRefusal,
  toggleSend,
  withOutcome,
} from './previous-sends';

const bc = (n: number, over: Partial<PreviousSendOption> = {}): PreviousSendOption => ({
  kind: 'broadcast',
  id: uuid(n),
  name: `Broadcast ${n}`,
  at: '2026-10-01T09:00:00.000Z',
  recipients: 100,
  delivered: 90,
  read: 60,
  replied: null,
  clicked: null,
  failed: 10,
  ...over,
});
const cp = (n: number, over: Partial<PreviousSendOption> = {}): PreviousSendOption => ({
  ...bc(n),
  kind: 'campaign',
  name: `Campaign ${n}`,
  replied: 25,
  clicked: 15,
  ...over,
});
const ref = (o: PreviousSendOption) => ({ kind: o.kind, id: o.id });
const audience = (
  sends: PreviousSendsAudience['sends'],
  outcome: PreviousSendsAudience['outcome'] = 'all',
): PreviousSendsAudience => ({ sends, outcome });

describe('outcomeCount', () => {
  it('reads the number the send recorded, null when it does not record it', () => {
    expect(outcomeCount(bc(1), 'all')).toBe(100);
    expect(outcomeCount(bc(1), 'delivered')).toBe(90);
    expect(outcomeCount(bc(1), 'read')).toBe(60);
    expect(outcomeCount(bc(1), 'failed')).toBe(10);
    expect(outcomeCount(bc(1), 'replied')).toBeNull();
    expect(outcomeCount(bc(1), 'clicked')).toBeNull();
    expect(outcomeCount(bc(1), 'not_replied')).toBeNull();
    expect(outcomeCount(cp(2), 'replied')).toBe(25);
    expect(outcomeCount(cp(2), 'clicked')).toBe(15);
  });

  it('counts "did not" as the sent ones minus the failed and the ones who did', () => {
    expect(outcomeCount(bc(1), 'not_read')).toBe(30);
    expect(outcomeCount(cp(2), 'not_replied')).toBe(65);
    expect(outcomeCount(bc(1, { read: 200 }), 'not_read')).toBe(0);
  });
});

describe('outcomes a broadcast cannot give', () => {
  it('blocks replied, not replied and clicked while a broadcast is ticked', () => {
    const p = audience([ref(bc(1)), ref(cp(2))]);
    for (const o of ['replied', 'not_replied', 'clicked'] as const)
      expect(outcomeBlocked(p.sends, o)).toBe(true);
    for (const o of ['all', 'delivered', 'read', 'not_read', 'failed'] as const)
      expect(outcomeBlocked(p.sends, o)).toBe(false);
    expect(outcomeBlocked([ref(cp(2))], 'clicked')).toBe(false);
  });

  it('refuses to change to such an outcome, and allows the rest', () => {
    const p = audience([ref(bc(1))]);
    expect(withOutcome(p, 'replied')).toBe(p);
    expect(withOutcome(p, 'read').outcome).toBe('read');
    expect(withOutcome(audience([ref(cp(2))]), 'clicked').outcome).toBe('clicked');
  });

  it('refuses to tick a broadcast while the outcome is about replies or clicks', () => {
    const p = audience([ref(cp(2))], 'replied');
    expect(tickRefusal(p, ref(bc(1)))).toBe('outcome');
    expect(toggleSend(p, ref(bc(1)))).toBe(p);
    expect(tickRefusal(p, ref(cp(3)))).toBeNull();
  });
});

describe('ticking', () => {
  it('ticks and un-ticks, keeping a broadcast and a campaign of the same id apart', () => {
    const a = bc(1);
    const same = { ...cp(2), id: a.id };
    let p = toggleSend(EMPTY_PREVIOUS, ref(a));
    p = toggleSend(p, ref(same));
    expect(p.sends).toHaveLength(2);
    p = toggleSend(p, ref(a));
    expect(p.sends).toEqual([ref(same)]);
  });

  it('stops at 20 and says why, but still lets one be un-ticked', () => {
    const many = Array.from({ length: 20 }, (_, i) => ref(cp(i + 1)));
    const full = audience(many);
    expect(tickRefusal(full, ref(cp(99)))).toBe('limit');
    expect(toggleSend(full, ref(cp(99)))).toBe(full);
    expect(tickRefusal(full, many[0]!)).toBeNull();
    expect(toggleSend(full, many[0]!).sends).toHaveLength(19);
  });
});

describe('sanitizePrevious', () => {
  it('keeps null and undefined, drops repeats and refs beyond 20', () => {
    expect(sanitizePrevious(null)).toBeNull();
    expect(sanitizePrevious(undefined)).toBeUndefined();
    const dup = audience([ref(cp(1)), ref(cp(1)), ref(cp(2))]);
    expect(sanitizePrevious(dup)?.sends).toHaveLength(2);
    const many = audience(Array.from({ length: 25 }, (_, i) => ref(cp(i + 1))));
    expect(sanitizePrevious(many)?.sends).toHaveLength(20);
  });

  it('turns an unknown outcome, or one a ticked broadcast cannot give, back into "all"', () => {
    const odd = { sends: [ref(cp(1))], outcome: 'bogus' } as unknown as PreviousSendsAudience;
    expect(sanitizePrevious(odd)?.outcome).toBe('all');
    expect(sanitizePrevious(audience([ref(bc(1))], 'clicked'))?.outcome).toBe('all');
    expect(sanitizePrevious(audience([ref(cp(1))], 'clicked'))?.outcome).toBe('clicked');
  });
});

describe('estimate and names', () => {
  const options = [bc(1), cp(2)];
  it('adds up the chosen outcome of the picked sends, counting a missing send for nothing', () => {
    expect(previousEstimate(audience([ref(bc(1)), ref(cp(2))], 'read'), options)).toBe(120);
    expect(previousEstimate(audience([ref(cp(2)), ref(cp(9))], 'replied'), options)).toBe(25);
    expect(previousEstimate(audience([ref(bc(1))], 'all'), [])).toBe(0);
    expect(previousEstimate(null, options)).toBe(0);
  });

  it('names the picked sends and flags one that is gone', () => {
    expect(previousNames(audience([ref(bc(1)), ref(cp(9))]), options)).toEqual([
      { key: `broadcast:${uuid(1)}`, name: 'Broadcast 1', found: true },
      { key: `campaign:${uuid(9)}`, name: uuid(9), found: false },
    ]);
  });

  it('knows when nothing is picked', () => {
    expect(hasPrevious(EMPTY_PREVIOUS)).toBe(false);
    expect(hasPrevious(null)).toBe(false);
    expect(hasPrevious(audience([ref(bc(1))]))).toBe(true);
  });
});
