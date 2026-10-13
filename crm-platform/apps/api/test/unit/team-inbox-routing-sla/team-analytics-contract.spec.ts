import { describe, expect, it } from 'vitest';
import { teamAnalyticsQuerySchema } from '@crm/contracts';

describe('teamAnalyticsQuerySchema', () => {
  it('reads today, week and month and anything else as today', () => {
    expect(teamAnalyticsQuerySchema.parse({}).range).toBe('today');
    expect(teamAnalyticsQuerySchema.parse({ range: 'week' }).range).toBe('week');
    expect(teamAnalyticsQuerySchema.parse({ range: 'month' }).range).toBe('month');
    expect(teamAnalyticsQuerySchema.parse({ range: 'foo' }).range).toBe('today');
  });

  it('takes a channel as a uuid only', () => {
    const id = '0b2f7a68-3c3e-4a9a-9d5b-6a1f0f3e1c11';
    expect(teamAnalyticsQuerySchema.parse({ channelId: id }).channelId).toBe(id);
    expect(teamAnalyticsQuerySchema.safeParse({ channelId: '7' }).success).toBe(false);
  });
});
