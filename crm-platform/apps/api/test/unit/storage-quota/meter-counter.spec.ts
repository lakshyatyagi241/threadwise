import { beforeEach, describe, expect, it, vi } from 'vitest';

const observe = vi.fn();
vi.mock('@crm/observability', () => ({
  getRuntimeMonitor: () => ({ observeStorageMeterFailure: observe }),
}));

import {
  meterFailedOpen,
  reserveOn,
  type StorageMeter,
} from '../../../src/common/storage-meter/storage-meter.port';

/** A metering step that fails is COUNTED (crm_storage_meter_failures_total, by step), not only logged: that is how an operator sees drift coming. */
describe('the fail-open counter', () => {
  beforeEach(() => observe.mockClear());

  it('counts the step that failed', async () => {
    meterFailedOpen('commit', 7, new Error('x'));
    expect(observe).toHaveBeenCalledWith('commit');
  });

  it('counts a reserve that threw, and still returns a usable reservation', async () => {
    const meter: StorageMeter = {
      reserve: () => Promise.reject(new Error('down')),
      recordRemoved: () => Promise.resolve(),
    };
    const r = await reserveOn(meter, { orgId: 7, bytes: 1, category: 'inbox_media' });
    await expect(r.commit({ key: 'k' })).resolves.toBeUndefined();
    expect(observe).toHaveBeenCalledWith('reserve');
  });

  it('a counter that itself throws never reaches the caller', () => {
    observe.mockImplementationOnce(() => {
      throw new Error('registry gone');
    });
    expect(() => meterFailedOpen('release', 7, new Error('x'))).not.toThrow();
  });
});
