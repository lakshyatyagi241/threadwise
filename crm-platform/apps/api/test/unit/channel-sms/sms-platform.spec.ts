import { describe, expect, it, vi } from 'vitest';
import { PlatformSettingsService } from '../../../src/modules/auth/platform/platform-settings.service';
import {
  SmsAvailability,
  SMS_ENABLED_KEY,
} from '../../../src/modules/channel-sms/sms-availability.service';
import { SmsPlatformService } from '../../../src/modules/channel-sms/sms-platform.service';

/** A platform store holding `current` for `sms_enabled`; writes through `execute` change it, like the real upsert does. */
function rig(current: unknown) {
  const state = { value: current as unknown, writes: [] as unknown[] };
  const audit = { record: vi.fn(async () => undefined) };
  const tx = {
    execute: async (q: { queryChunks?: unknown[] }) => {
      const text = JSON.stringify(q.queryChunks ?? []);
      if (text.includes('INSERT INTO platform_settings')) {
        const m = /"(true|false)"/.exec(text);
        state.value = m ? m[1] === 'true' : state.value;
        state.writes.push(state.value);
        return { rows: [] };
      }
      if (text.includes('FOR UPDATE')) {
        return { rows: state.value === undefined ? [] : [{ value: state.value }] };
      }
      // the snapshot read of every row
      return {
        rows:
          state.value === undefined
            ? []
            : [{ key: SMS_ENABLED_KEY, value: state.value, is_secret: false }],
      };
    },
  };
  const fake = { tx: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
  const store = new PlatformSettingsService(fake as never, {} as never);
  const service = new SmsPlatformService(store, audit as never, new SmsAvailability(store));
  return { service, state, audit, store };
}

describe('SmsPlatformService', () => {
  it('reads off when there is no row, and on for the accepted truthy spellings', async () => {
    expect(await rig(undefined).service.read()).toEqual({ enabled: false });
    expect(await rig(false).service.read()).toEqual({ enabled: false });
    for (const v of [true, 1, '1', 'true']) {
      expect(await rig(v).service.read()).toEqual({ enabled: true });
    }
  });

  it('turns on, audits before and after, and the availability reads the change without waiting for the cache', async () => {
    const { service, audit, store } = rig(undefined);
    // warm the snapshot with the old value
    expect(await new SmsAvailability(store).platformEnabled()).toBe(false);
    expect(await service.update({ enabled: true }, 9)).toEqual({ enabled: true });
    expect(await new SmsAvailability(store).platformEnabled()).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event: 'platform.sms_updated',
        actorType: 'platform_operator',
        actorId: 9,
        payload: { before: { enabled: false }, after: { enabled: true } },
      }),
    );
  });

  it('turning it off records before true, and setting the same state still audits', async () => {
    const { service, audit } = rig(true);
    expect(await service.update({ enabled: false }, 3)).toEqual({ enabled: false });
    expect(await service.update({ enabled: false }, 3)).toEqual({ enabled: false });
    expect(audit.record).toHaveBeenCalledTimes(2);
    const payloads = audit.record.mock.calls.map(
      (c) => (c as unknown[])[1] as { payload: unknown },
    );
    expect(payloads[0]!.payload).toEqual({ before: { enabled: true }, after: { enabled: false } });
    expect(payloads[1]!.payload).toEqual({ before: { enabled: false }, after: { enabled: false } });
  });
});
