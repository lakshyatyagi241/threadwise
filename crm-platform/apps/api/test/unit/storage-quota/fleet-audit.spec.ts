import { describe, expect, it, vi } from 'vitest';
import { StorageFleetService } from '../../../src/modules/storage-quota/storage-fleet.service';

/**
 * Operator reads of the storage fleet leave an audit row, found or not (spec 14).
 */
describe('StorageFleetService audit rows', () => {
  const empty = { rows: [] };
  // fleet(): totals, byCategory, top, levels, drift, lastRun, in that order
  const fleetQueries = () => [
    { rows: [{ workspaces: 0, hot: 0, reserved: 0, cold: 0, objects: 0 }] },
    empty,
    empty,
    empty,
    { rows: [{ drifting: 0, drift_bytes: 0 }] },
    { rows: [{ last_run: null }] },
  ];

  function build(queries: unknown[]) {
    const audit = { recordStandalone: vi.fn(async () => undefined) };
    const execute = vi.fn();
    for (const q of queries) execute.mockResolvedValueOnce(q);
    execute.mockResolvedValue(empty);
    const tx = { execute };
    const store = { tx: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
    const svc = new StorageFleetService(
      store as never,
      {} as never,
      { configured: vi.fn(async () => 'off') } as never,
      audit as never,
    );
    return { svc, audit };
  }

  it('records the fleet view', async () => {
    const t = build(fleetQueries());
    await t.svc.fleet(new Date('2026-10-31T00:00:00Z'));
    expect(t.audit.recordStandalone).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'platform.storage.fleet_viewed', status: 'success' }),
    );
  });

  it('records a lookup of a workspace that does not exist, then answers 404', async () => {
    const t = build([]);
    await expect(t.svc.workspace('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({
      status: 404,
    });
    expect(t.audit.recordStandalone).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'platform.storage.workspace_viewed',
        status: 'failure',
        payload: expect.objectContaining({ reason: 'not_found' }),
      }),
    );
  });
});
