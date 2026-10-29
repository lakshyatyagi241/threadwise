import { describe, expect, it } from 'vitest';
import { FlowLaunchService } from '../../../src/modules/flow-runtime-engine/runtime/launch.service';

/**
 * Issue #1175: a retry used to relaunch whatever the subscriber's status was. Two retries of one failed subscriber both passed, and the
 * second cancelled the first run. The subscriber row is locked by the time this check runs, so the second retry sees `active`.
 */
describe('retry relaunch only from a failed subscriber (#1175)', () => {
  const check = (status: string) => {
    const svc = Object.create(FlowLaunchService.prototype) as unknown as {
      mayRelaunch: (tx: unknown, orgId: number, sub: unknown, input: unknown) => Promise<boolean>;
    };
    return svc.mayRelaunch({}, 7, { status, lastRunId: 1 }, { retry: true, source: 'manual' });
  };

  it('relaunches a failed subscriber', async () => {
    expect(await check('failed')).toBe(true);
  });

  it('does not relaunch a subscriber a racing retry has already made active', async () => {
    expect(await check('active')).toBe(false);
  });

  it('does not relaunch a paused subscriber on a retry', async () => {
    expect(await check('paused')).toBe(false);
  });

  it('does not relaunch a completed subscriber on a retry', async () => {
    expect(await check('completed')).toBe(false);
  });
});
