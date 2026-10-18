import { describe, expect, it } from 'vitest';
import type { WabaNumberThroughput } from '@crm/contracts';
import { loadOf, needsAttention, sparkPoints, tierTone } from './format';

const base: WabaNumberThroughput = {
  id: '8f1b6a52-2f0e-4d51-a9c7-2d3d7f7a1c11',
  workspace: 'Acme',
  phoneNumberId: '100200300',
  displayPhoneNumber: '+91 99000 00001',
  label: null,
  status: 'connected',
  qualityRating: 'GREEN',
  coexistence: false,
  metaLevel: 'STANDARD',
  metaMps: 80,
  effectiveMps: 72,
  source: 'meta',
  control: { overrideMps: null, paused: false, pauseReason: null, updatedAt: null },
  tier: { name: 'TIER_1K', cap: 1000, used24h: 10, pct: 1, state: 'ok' },
  live: {
    mpsNow: 36,
    peak1m: 50,
    sent5m: 100,
    waited5m: 0,
    avgWaitMs5m: 0,
    deferred5m: 0,
    metaThrottled5m: 0,
    speedFactor: 1,
  },
  syncedAt: null,
  syncError: null,
  rowVersion: 1,
};

describe('needsAttention', () => {
  it('is quiet for a healthy number', () => expect(needsAttention(base)).toBe(false));

  it.each([
    ['paused', { control: { ...base.control, paused: true } }],
    ['slowed', { live: { ...base.live, speedFactor: 0.5 } }],
    ['throttled by Meta', { live: { ...base.live, metaThrottled5m: 1 } }],
    ['tier warning', { tier: { ...base.tier, state: 'warn' as const } }],
    ['tier full', { tier: { ...base.tier, state: 'full' as const } }],
    ['sync failed', { syncError: 'token expired' }],
  ])('flags a number that is %s', (_name, over) => {
    expect(needsAttention({ ...base, ...over })).toBe(true);
  });
});

describe('loadOf', () => {
  it('is the share of the paced rate in use', () => expect(loadOf(base)).toBeCloseTo(0.5));
  it('is zero without a rate and never above 1.5', () => {
    expect(loadOf({ ...base, effectiveMps: 0 })).toBe(0);
    expect(loadOf({ ...base, live: { ...base.live, mpsNow: 5000 } })).toBe(1.5);
  });
});

describe('sparkPoints', () => {
  it('scales a series into the box', () => {
    expect(sparkPoints([{ sent: 0 }, { sent: 5 }, { sent: 10 }], 100, 20)).toBe(
      '0.0,20.0 50.0,10.0 100.0,0.0',
    );
  });
  it('uses a ceiling so a quiet series is not stretched', () => {
    expect(sparkPoints([{ sent: 1 }, { sent: 1 }], 10, 10, 10)).toBe('0.0,9.0 10.0,9.0');
  });
  it('is empty without two points', () => expect(sparkPoints([{ sent: 1 }], 10, 10)).toBe(''));
});

describe('tierTone', () => {
  it('maps the tier states to tones', () => {
    expect(tierTone('full')).toBe('danger');
    expect(tierTone('warn')).toBe('warning');
    expect(tierTone('ok')).toBe('success');
    expect(tierTone('unlimited')).toBe('neutral');
  });
});
