import { describe, expect, it } from 'vitest';
import {
  amountIn,
  canAddFollowUp,
  followUpIndexOf,
  maxAmount,
  newFollowUp,
  supportsFollowUps,
  toMinutes,
  unitOf,
} from './follow-ups';

describe('follow-up wait units', () => {
  it('shows a wait in the largest whole unit', () => {
    expect(unitOf(1)).toBe('minutes');
    expect(unitOf(90)).toBe('minutes');
    expect(unitOf(120)).toBe('hours');
    expect(unitOf(2880)).toBe('days');
    expect(unitOf(10_080)).toBe('days');
    expect(amountIn(120, 'hours')).toBe(2);
    expect(amountIn(2880, 'days')).toBe(2);
  });

  it('converts to minutes and keeps 1 minute to 7 days', () => {
    expect(toMinutes(3, 'hours')).toBe(180);
    expect(toMinutes(2, 'days')).toBe(2880);
    expect(toMinutes(0, 'minutes')).toBe(1);
    expect(toMinutes(8, 'days')).toBe(10_080);
    expect(toMinutes(999, 'hours')).toBe(10_080);
    expect([maxAmount('minutes'), maxAmount('hours'), maxAmount('days')]).toEqual([10_080, 168, 7]);
  });
});

describe('follow-up helpers', () => {
  it('starts a step with the template not chosen yet and stops at 3', () => {
    expect(newFollowUp().action).toEqual({ kind: 'template', templateId: null });
    const one = newFollowUp();
    expect(canAddFollowUp([one, one])).toBe(true);
    expect(canAddFollowUp([one, one, one])).toBe(false);
  });

  it('only a Cloud API sender (or none picked yet) can have follow-ups', () => {
    expect(supportsFollowUps(null)).toBe(true);
    expect(supportsFollowUps('waba:abc')).toBe(true);
    expect(supportsFollowUps('baileys:abc')).toBe(false);
  });

  it('reads the step number out of an issue path', () => {
    expect(followUpIndexOf('followUps.2.action')).toBe(2);
    expect(followUpIndexOf('followUps')).toBeNull();
    expect(followUpIndexOf('retries.endDate')).toBeNull();
  });
});
