import { describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../common/context/request-context';
import { DashService } from './dash.service';

/**
 * The analytics CSV must read its figures and its created counts on one transaction (one snapshot), not two.
 * Regression for the dashboards issue that found two transactions in analyticsCsv().
 */
function fakeAnalytics() {
  return {
    window: {
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-08T00:00:00.000Z',
      fromDate: '2026-10-01',
      toDate: '2026-10-07',
    },
    current: {
      sent: 5,
      delivered: 4,
      read: 3,
      failed: 1,
      queued: 0,
      replies: 2,
      deliverability: 80,
      readRate: 60,
      replyRate: 40,
    },
    daily: { dates: ['2026-10-01'], sent: [5], delivered: [4], failed: [1], queued: [0] },
  };
}

function build() {
  const tx = { tag: 'tx' };
  const db = {
    tx: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  const panelsRepo = {
    created: vi.fn(async () => ({ campaigns: 2, broadcasts: 1, contacts: 9 })),
  };
  const config = { get: vi.fn(() => 'Threadwise') };
  const service = new DashService(
    db as never,
    {} as never,
    {} as never,
    panelsRepo as never,
    {} as never,
    {} as never,
    config as never,
    {} as never,
  );
  const analyticsIn = vi
    .spyOn(
      service as unknown as { analyticsIn: (...a: unknown[]) => Promise<unknown> },
      'analyticsIn',
    )
    .mockResolvedValue(fakeAnalytics());
  return { db, tx, panelsRepo, analyticsIn, service };
}

describe('DashService.analyticsCsv', () => {
  it('reads the figures and the created counts in one transaction', async () => {
    const { db, tx, panelsRepo, analyticsIn, service } = build();
    await RequestContextStore.run({ requestId: 'r', orgId: 7 } as never, () =>
      service.analyticsCsv({ range: '7d' } as never, new Date('2026-10-08T00:00:00Z')),
    );
    expect(db.tx).toHaveBeenCalledTimes(1);
    expect(analyticsIn).toHaveBeenCalledWith(tx, { range: '7d' }, expect.any(Date));
    expect(panelsRepo.created).toHaveBeenCalledWith(tx, 7, expect.any(Date), expect.any(Date));
  });

  it('writes the same rows and file name as before', async () => {
    const { service } = build();
    const file = await RequestContextStore.run({ requestId: 'r', orgId: 7 } as never, () =>
      service.analyticsCsv({ range: '7d' } as never, new Date('2026-10-08T00:00:00Z')),
    );
    expect(file.filename).toBe('threadwise-analytics-2026-10-01-2026-10-07.csv');
    expect(file.body).toContain('Campaigns,2');
    expect(file.body).toContain('Broadcasts,1');
    expect(file.body).toContain('Contacts added,9');
    expect(file.body).toContain('2026-10-01,5,4,1,0');
  });
});
