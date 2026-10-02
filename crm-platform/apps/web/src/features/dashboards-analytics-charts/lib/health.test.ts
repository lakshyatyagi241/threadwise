import { describe, expect, it } from 'vitest';
import type { HealthCheck } from '@crm/contracts';
import { diskToneOf, latencyBars, toneOf } from './health';

const check = (key: HealthCheck['key'], ping: number | null): HealthCheck => ({
  key,
  state: 'up',
  value: 'v',
  detail: 'd',
  ping,
});

describe('system health view rules', () => {
  it('maps probe states to badge tones', () => {
    expect([toneOf('up'), toneOf('warn'), toneOf('down'), toneOf('idle')]).toEqual([
      'success',
      'warning',
      'danger',
      'neutral',
    ]);
  });

  it('colours the disk bar red above 90, amber above 75, else green', () => {
    expect([diskToneOf(92), diskToneOf(80), diskToneOf(75), diskToneOf(10)]).toEqual([
      'danger',
      'warning',
      'success',
      'success',
    ]);
  });

  it('draws bars only for database, bridge and storage with a measured time, widths relative to the slowest, at least 3%', () => {
    const bars = latencyBars([
      check('database', 2),
      check('cache', 1),
      check('bridge', 200),
      check('storage', null),
    ]);
    expect(bars.map((b) => b.key)).toEqual(['database', 'bridge']);
    expect(bars[1]!.width).toBe(100);
    expect(bars[0]!.width).toBe(3);
    expect(latencyBars([])).toEqual([]);
  });
});
