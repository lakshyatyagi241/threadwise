import { summary } from '@/test/dashboard-fixtures';
import { funnelStages } from './funnel-model';

describe('funnelStages', () => {
  it('shares every stage of the contacts messaged, one decimal', () => {
    expect(funnelStages(summary.funnel)).toEqual([
      { key: 'messaged', count: 120, pct: 100 },
      { key: 'delivered', count: 110, pct: 91.7 },
      { key: 'replied', count: 40, pct: 33.3 },
      { key: 'goalCompleted', count: 12, pct: 10 },
    ]);
  });

  it('draws empty bars when nobody was messaged, and never passes 100%', () => {
    const none = {
      ...summary.funnel,
      contacts: { messaged: 0, delivered: 0, replied: 5, goalCompleted: 0 },
    };
    expect(funnelStages(none).map((s) => s.pct)).toEqual([0, 0, 0, 0]);
    const over = {
      ...summary.funnel,
      contacts: { messaged: 10, delivered: 10, replied: 25, goalCompleted: 0 },
    };
    expect(funnelStages(over)[2]?.pct).toBe(100);
  });
});
