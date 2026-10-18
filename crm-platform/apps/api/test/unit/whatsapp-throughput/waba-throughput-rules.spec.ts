import { describe, expect, it } from 'vitest';
import { WABA_THROUGHPUT_SETTINGS_DEFAULTS } from '@crm/contracts';
import {
  limitsOf,
  numberView,
  publishedOf,
  syncDue,
  syncPatch,
  totalsOf,
  type NumberRow,
} from '../../../src/modules/whatsapp-cloud-api-waba/waba-throughput-rules';

const S = WABA_THROUGHPUT_SETTINGS_DEFAULTS;
const row = (meta: Record<string, unknown>): NumberRow => ({
  orgId: 7,
  uuid: '8f1b6a52-2f0e-4d51-a9c7-2d3d7f7a1c11',
  status: 'connected',
  phone_number: '+91 99000 00001',
  display_label: 'Support',
  meta_json: { phone_number_id: '100200300', ...meta },
  row_version: 3,
  workspace: 'Acme',
});

describe('limitsOf', () => {
  it('reads the operator’s override and pause', () => {
    expect(
      limitsOf({
        send_limits: { override_mps: 40, paused: true, pause_reason: 'review', updated_at: 't' },
      }),
    ).toEqual({ overrideMps: 40, paused: true, pauseReason: 'review', updatedAt: 't' });
  });

  it.each([
    null,
    undefined,
    {},
    { send_limits: 'x' },
    { send_limits: { override_mps: -1, paused: 'yes' } },
  ])('defaults when %j says nothing usable', (meta) => {
    expect(limitsOf(meta as never)).toEqual({
      overrideMps: null,
      paused: false,
      pauseReason: null,
      updatedAt: null,
    });
  });
});

describe('publishedOf', () => {
  it('paces a standard number at 80 less the margin', () => {
    expect(
      publishedOf({ throughput: { level: 'STANDARD' }, messaging_limit_tier: 'TIER_1K' }, S),
    ).toMatchObject({
      mps: 72,
      capMps: 80,
      source: 'meta',
      tierCap: 1000,
      paused: false,
    });
  });

  it('follows an upgrade to 1,000', () => {
    expect(publishedOf({ throughput: { level: 'HIGH' } }, S)).toMatchObject({
      mps: 900,
      capMps: 1000,
    });
  });

  it('pins a coexistence number to 20, by flag or by platform type', () => {
    expect(publishedOf({ coexistence: true, throughput: { level: 'HIGH' } }, S).capMps).toBe(20);
    expect(publishedOf({ platform_type: 'SMB_APP' }, S).source).toBe('coexistence');
  });

  it('uses the default for a number Meta has not described', () => {
    expect(publishedOf({}, { ...S, defaultMps: 50, safetyMarginPct: 0 })).toMatchObject({
      mps: 50,
      source: 'default',
    });
  });

  it('carries an override and a pause', () => {
    expect(
      publishedOf({ send_limits: { override_mps: 15, paused: true, pause_reason: 'x' } }, S),
    ).toMatchObject({ mps: 15, source: 'override', paused: true, pauseReason: 'x' });
  });

  it('marks an unlimited tier', () => {
    expect(publishedOf({ messaging_limit_tier: 'TIER_UNLIMITED' }, S)).toMatchObject({
      tierUnlimited: true,
      tierCap: 0,
    });
  });
});

describe('numberView', () => {
  it('joins the stored number with its live counters and tier use', () => {
    const v = numberView(
      row({
        throughput: { level: 'STANDARD' },
        messaging_limit_tier: 'TIER_1K',
        quality_rating: 'GREEN',
      }),
      S,
      {
        mpsNow: 12.5,
        peak1m: 40,
        sent5m: 900,
        waited5m: 10,
        waitMs5m: 250,
        deferred5m: 2,
        metaThrottled5m: 1,
        speedFactor: 0.5,
        paused: false,
      },
      850,
    );
    expect(v).toMatchObject({
      id: '8f1b6a52-2f0e-4d51-a9c7-2d3d7f7a1c11',
      workspace: 'Acme',
      phoneNumberId: '100200300',
      metaLevel: 'STANDARD',
      metaMps: 80,
      effectiveMps: 72,
      source: 'meta',
      qualityRating: 'GREEN',
      rowVersion: 3,
    });
    expect(v.tier).toEqual({ name: 'TIER_1K', cap: 1000, used24h: 850, pct: 85, state: 'warn' });
    expect(v.live).toMatchObject({
      mpsNow: 12.5,
      avgWaitMs5m: 25,
      deferred5m: 2,
      speedFactor: 0.5,
    });
  });

  it('shows zeros, not errors, when Redis could not be read', () => {
    const v = numberView(row({}), S, undefined, 0);
    expect(v.live).toMatchObject({ mpsNow: 0, sent5m: 0, speedFactor: 1 });
    expect(v.tier.state).toBe('unknown');
  });
});

describe('totalsOf', () => {
  it('adds up the fleet and counts what needs attention', () => {
    const a = numberView(row({ send_limits: { paused: true } }), S, undefined, 0);
    const b = numberView(
      row({ messaging_limit_tier: 'TIER_250' }),
      S,
      {
        mpsNow: 3,
        peak1m: 5,
        sent5m: 100,
        waited5m: 0,
        waitMs5m: 0,
        deferred5m: 4,
        metaThrottled5m: 2,
        speedFactor: 0.5,
        paused: false,
      },
      250,
    );
    expect(totalsOf([a, b])).toEqual({
      numbers: 2,
      paused: 1,
      throttled: 1,
      tierWarn: 1,
      mpsNow: 3,
      sent5m: 100,
      deferred5m: 4,
      metaThrottled5m: 2,
    });
  });
});

describe('sync', () => {
  it('stores what Meta said and clears the last error', () => {
    const patch = syncPatch(
      {
        throughput: { level: 'HIGH' },
        messagingLimitTier: 'TIER_100K',
        qualityRating: 'GREEN',
        platformType: 'CLOUD_API',
      },
      new Date('2026-10-18T13:00:00Z'),
    );
    expect(patch).toMatchObject({
      throughput: { level: 'HIGH' },
      messaging_limit_tier: 'TIER_100K',
      throughput_synced_at: '2026-10-18T13:00:00.000Z',
      throughput_sync_error: null,
    });
  });

  it('is due when never read, or older than the interval', () => {
    const now = new Date('2026-10-18T13:00:00Z');
    expect(syncDue({}, 30, now)).toBe(true);
    expect(syncDue({ throughput_synced_at: '2026-10-18T12:20:00Z' }, 30, now)).toBe(true);
    expect(syncDue({ throughput_synced_at: '2026-10-18T12:45:00Z' }, 30, now)).toBe(false);
    expect(syncDue({ throughput_synced_at: 'garbage' }, 30, now)).toBe(true);
  });
});
