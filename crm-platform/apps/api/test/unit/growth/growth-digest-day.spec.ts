import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GrowthService } from '../../../src/modules/growth-pilot/growth.service';

// 20:30 UTC on the 26th is already the 27th in Kolkata, so a digest stored for the 26th is stale there.
const NOW = new Date('2026-10-26T20:30:00Z');

function build(stored: { day: string } | null) {
  const saved: string[] = [];
  const facts = Object.fromEntries(
    [
      'sent',
      'read',
      'replied',
      'hot',
      'unanswered',
      'optouts',
      'pending',
      'lapsed',
      'open_actions',
      'new_chats',
      'top_propensity',
    ].map((k) => [k, '0']),
  );
  const repo = {
    latestDigest: async () => stored,
    timezone: async () => 'Asia/Kolkata',
    digestFacts: async () => facts,
    saveDigest: async (_tx: unknown, _org: number, day: string) => void saved.push(day),
  };
  const gate = {
    require: async () => ({
      available: true,
      features: { daily_digest: true },
      config: {},
      rowVersion: 1,
    }),
  };
  const db = { txAs: async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn({}) };
  const enrichment = { configured: () => false };
  const svc = new GrowthService(
    db as never,
    repo as never,
    gate as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    enrichment as never,
    {} as never,
    {} as never,
  );
  return { svc, saved };
}

describe('growth digest day', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('rebuilds a stored digest that is from the previous day in the workspace zone', async () => {
    const { svc, saved } = build({ day: '2026-10-26' });
    const overview = await svc.overview(7);
    expect(overview.digest?.day).toBe('2026-10-27');
    expect(saved).toEqual(['2026-10-27']);
  });

  it('serves the stored digest when it is already for today in the workspace zone', async () => {
    const stored = { day: '2026-10-27' };
    const { svc, saved } = build(stored);
    const overview = await svc.overview(7);
    expect(overview.digest).toEqual(stored);
    expect(saved).toEqual([]);
  });
});
