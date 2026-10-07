import { describe, expect, it } from 'vitest';
import type { DashFunnel } from '@crm/contracts';
import { funnelStages } from './funnel-model';

const funnel = (
  messaged: number,
  delivered: number,
  replied: number,
  goalCompleted = 0,
): DashFunnel => ({
  stages: [],
  endToEnd: 0,
  contacts: { messaged, delivered, replied, goalCompleted },
  activity: { inbound: 0, respondingContacts: replied, repliesPerContact: null },
  replyRate: 0,
  comparison: null,
});

describe('funnelStages', () => {
  it('shows percent of contacts messaged', () => {
    expect(funnelStages(funnel(31, 31, 4, 3)).map((s) => [s.key, s.count, s.pct])).toEqual([
      ['messaged', 31, 100],
      ['delivered', 31, 100],
      ['replied', 4, 12.9],
      ['goalCompleted', 3, 9.7],
    ]);
  });
  it('is all zero with nobody messaged, and caps replied at 100', () => {
    expect(funnelStages(funnel(0, 0, 0)).map((s) => s.pct)).toEqual([0, 0, 0, 0]);
    expect(funnelStages(funnel(1, 1, 2)).map((s) => s.pct)).toEqual([100, 100, 100, 0]);
  });
  it('always keeps the goal stage, empty when no flow finished, and caps it at 100', () => {
    const s = funnelStages(funnel(5, 5, 1, 0));
    expect(s).toHaveLength(4);
    expect(s[3]).toEqual({ key: 'goalCompleted', count: 0, pct: 0 });
    expect(funnelStages(funnel(1, 1, 1, 3))[3]!.pct).toBe(100);
  });
});
