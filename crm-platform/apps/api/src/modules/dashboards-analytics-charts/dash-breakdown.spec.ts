import { describe, expect, it } from 'vitest';
import { foldBreakdown, type BreakdownRow } from './dash-breakdown';

interface Msg {
  day: number;
  dow: number;
  hour: number;
  direction: 'in' | 'out';
  type: string;
  delivered: boolean;
  failed: boolean;
}

const TYPES = ['text', 'template', 'media', 'location', 'interactive'];

/** A fixed pseudo-random message list, so a failure reproduces. */
function messages(count: number): Msg[] {
  let seed = 42;
  const next = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  return Array.from({ length: count }, () => {
    const day = next(30);
    const failed = next(9) === 0;
    return {
      day,
      dow: day % 7,
      hour: next(24),
      direction: next(3) === 0 ? 'in' : 'out',
      type: TYPES[next(TYPES.length)]!,
      delivered: !failed && next(4) !== 0,
      failed,
    };
  });
}

/** What the three separate queries computed, message by message. */
function reference(msgs: Msg[]) {
  const days = new Map<number, { sent: number; delivered: number; failed: number }>();
  const types = new Map<string, { count: number; delivered: number }>();
  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const m of msgs) {
    heatmap[m.dow]![m.hour]!++;
    if (m.direction !== 'out') continue;
    const d = days.get(m.day) ?? { sent: 0, delivered: 0, failed: 0 };
    d.sent++;
    if (m.delivered) d.delivered++;
    if (m.failed) d.failed++;
    days.set(m.day, d);
    const t = types.get(m.type) ?? { count: 0, delivered: 0 };
    t.count++;
    if (m.delivered) t.delivered++;
    types.set(m.type, t);
  }
  return { days, types, heatmap };
}

/** The SQL's GROUP BY: one row per (day, weekday, hour, direction, type). */
function grouped(msgs: Msg[]): BreakdownRow[] {
  const rows = new Map<string, BreakdownRow>();
  for (const m of msgs) {
    const key = [m.day, m.dow, m.hour, m.direction, m.type].join('|');
    const r = rows.get(key) ?? {
      day: m.day,
      dow: m.dow,
      hour: m.hour,
      direction: m.direction,
      type: m.type,
      count: 0,
      delivered: 0,
      failed: 0,
    };
    r.count++;
    if (m.delivered) r.delivered++;
    if (m.failed) r.failed++;
    rows.set(key, r);
  }
  return [...rows.values()];
}

describe('foldBreakdown', () => {
  it('gives the same daily series, type mix and heatmap as counting message by message', () => {
    const msgs = messages(2000);
    const got = foldBreakdown(grouped(msgs));
    const want = reference(msgs);
    expect(got.days).toEqual(want.days);
    expect(got.heatmap).toEqual(want.heatmap);
    const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key);
    expect([...got.types].sort(byKey)).toEqual(
      [...want.types].map(([key, t]) => ({ key, ...t })).sort(byKey),
    );
  });

  it('counts inbound messages in the heatmap only', () => {
    const got = foldBreakdown([
      { day: 0, dow: 2, hour: 9, direction: 'in', type: 'text', count: 3, delivered: 3, failed: 0 },
    ]);
    expect(got.heatmap[2]![9]).toBe(3);
    expect(got.days.size).toBe(0);
    expect(got.types).toEqual([]);
  });

  it('is empty for a window with no messages', () => {
    const got = foldBreakdown([]);
    expect(got.days.size).toBe(0);
    expect(got.types).toEqual([]);
    expect(got.heatmap.flat().every((v) => v === 0)).toBe(true);
  });
});
