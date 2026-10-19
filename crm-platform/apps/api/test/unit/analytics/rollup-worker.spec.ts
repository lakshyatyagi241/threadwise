import { describe, expect, it, vi } from 'vitest';
import { RollupWorker } from '../../../src/modules/analytics/rollup/rollup.worker';
import type { RollupService } from '../../../src/modules/analytics/rollup/rollup.service';

function fakeService(overrides: Partial<Record<keyof RollupService, unknown>> = {}) {
  return {
    runOnce: vi.fn().mockResolvedValue({ from: new Date(), to: new Date(), slices: 1 }),
    watermarkAgeSeconds: vi.fn().mockResolvedValue(5),
    reconcile: vi.fn().mockResolvedValue({ fixedRows: 0 }),
    trimHourRows: vi.fn().mockResolvedValue(0),
    rebuildMessageBase: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as RollupService & Record<string, ReturnType<typeof vi.fn>>;
}
const config = (values: Record<string, boolean>) => ({ get: (k: string) => values[k] }) as never;

describe('RollupWorker', () => {
  it('runs one pass and checks the watermark age', async () => {
    const svc = fakeService();
    await new RollupWorker(svc).pass();
    expect(svc.runOnce).toHaveBeenCalledTimes(1);
    expect(svc.watermarkAgeSeconds).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the rollup is switched off', async () => {
    const svc = fakeService();
    await new RollupWorker(svc, config({ ANALYTICS_ROLLUP_ENABLED: false })).pass();
    expect(svc.runOnce).not.toHaveBeenCalled();
  });

  it('never overlaps itself: a tick that fires during a pass is skipped', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const svc = fakeService({
      runOnce: vi.fn().mockImplementation(async () => {
        await gate;
        return null;
      }),
    });
    const worker = new RollupWorker(svc);
    const first = worker.pass();
    await worker.pass();
    release();
    await first;
    expect(svc.runOnce).toHaveBeenCalledTimes(1);
  });

  it('survives a failing pass so the next tick can try again', async () => {
    const svc = fakeService({ runOnce: vi.fn().mockRejectedValue(new Error('db down')) });
    const worker = new RollupWorker(svc);
    await expect(worker.pass()).resolves.toBeUndefined();
    await worker.pass();
    expect(svc.runOnce).toHaveBeenCalledTimes(2);
  });

  it('reconciles yesterday and trims hour rows at night', async () => {
    const svc = fakeService();
    await new RollupWorker(svc).nightly();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    expect(svc.reconcile).toHaveBeenCalledWith(yesterday);
    expect(svc.rebuildMessageBase).toHaveBeenCalledWith(7);
    expect(svc.trimHourRows).toHaveBeenCalledWith(120);
  });

  it('keeps going when the nightly reconcile fails', async () => {
    const svc = fakeService({ reconcile: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(new RollupWorker(svc).nightly()).resolves.toBeUndefined();
  });
});
