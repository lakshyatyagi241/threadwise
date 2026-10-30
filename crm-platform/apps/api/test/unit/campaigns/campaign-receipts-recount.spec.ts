import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tx } from '@crm/db';
import { CampaignReceiptsService } from '../../../src/modules/campaigns/campaign-receipts.service';

// Three receipts arrive for every message sent. The roll-up of a campaign's counters reads every recipient and writes the one
// campaign row, so doing it per receipt makes a send cost more the bigger the campaign is. It runs at most once a second per campaign.
function service() {
  const recount = vi.fn(async () => undefined);
  const db = { txAs: async (_o: unknown, fn: (t: Tx) => Promise<unknown>) => fn({} as Tx) };
  const svc = new CampaignReceiptsService(db as never, { recount } as never, {} as never, {} as never);
  const soon = (campaignId: number) =>
    (svc as unknown as { recountSoon(t: Tx, o: number, c: number): Promise<void> }).recountSoon(
      {} as Tx,
      1,
      campaignId,
    );
  return { recount, soon };
}

describe('CampaignReceiptsService roll-up of counters', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('rolls up once for a burst of receipts, then once more after the second so the last counts land', async () => {
    const { recount, soon } = service();
    for (let i = 0; i < 50; i++) await soon(7);
    expect(recount).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(recount).toHaveBeenCalledTimes(2);
  });

  it('keeps campaigns apart', async () => {
    const { recount, soon } = service();
    await soon(7);
    await soon(8);
    expect(recount).toHaveBeenCalledTimes(2);
  });

  it('rolls up again for a receipt that comes a second later', async () => {
    const { recount, soon } = service();
    await soon(7);
    await vi.advanceTimersByTimeAsync(1_100);
    await soon(7);
    expect(recount).toHaveBeenCalledTimes(2);
  });
});
