import { describe, expect, it } from 'vitest';
import type { PullWindow } from '@crm/contracts';
import {
  formatWindowTime,
  narrowerSpan,
  planWindow,
  widerSpan,
} from '../../../src/infra/providers/marketplace';

const at = (iso: string) => new Date(iso);

const INDIAMART: PullWindow = {
  format: 'DD-MM-YYYYHH:mm:ss',
  utcOffsetMinutes: 330,
  maxSeconds: 518_400,
  overlapSeconds: 1800,
  initialLookbackSeconds: 86_400,
  maxLookbackSeconds: 31_536_000,
};

describe('writing a window in the portal format and zone', () => {
  it("IndiaMART's own format, in IST, with no space between the date and the time", () => {
    // 2026-10-04 06:00:00 UTC is 11:30:00 in India.
    expect(formatWindowTime(at('2026-10-04T06:00:00Z'), 'DD-MM-YYYYHH:mm:ss', 330)).toBe(
      '04-10-202611:30:00',
    );
    // Across midnight: 20:00 UTC is 01:30 the next day in India.
    expect(formatWindowTime(at('2026-12-31T20:00:00Z'), 'DD-MM-YYYYHH:mm:ss', 330)).toBe(
      '01-01-202701:30:00',
    );
  });

  it('epoch seconds ignore the zone; other tokens are written as typed', () => {
    expect(formatWindowTime(at('2026-10-04T06:00:00Z'), 'epoch', 330)).toBe('1791093600');
    expect(formatWindowTime(at('2026-10-04T06:00:00.900Z'), 'epoch', 0)).toBe('1791093600');
    expect(formatWindowTime(at('2026-10-04T06:00:00Z'), 'YYYY-MM-DD', 330)).toBe('2026-10-04');
    expect(formatWindowTime(at('2026-01-05T06:00:00Z'), 'DD-MON-YYYY', 0)).toBe('05-JAN-2026');
    expect(formatWindowTime(at('2026-01-05T06:00:00Z'), 'DD-Mon-YYYY', 0)).toBe('05-Jan-2026');
    expect(formatWindowTime(at('2026-10-04T06:09:07Z'), 'YYYY/MM/DD HH:mm:ss', 0)).toBe(
      '2026/10/04 06:09:07',
    );
  });
});

describe('planning the next window', () => {
  const now = at('2026-10-04T12:00:00Z');

  it('a new connection reaches back the first look-back and ends now', () => {
    const p = planWindow(INDIAMART, null, now, null);
    expect(p.start).toEqual(at('2026-10-03T12:00:00Z'));
    expect(p.end).toEqual(now);
    expect(p).toMatchObject({ behind: false, clamped: false, empty: false });
  });

  it('a later poll starts the overlap before where the last one ended, so nothing falls between two polls', () => {
    const p = planWindow(INDIAMART, at('2026-10-04T11:45:00Z'), now, null);
    expect(p.start).toEqual(at('2026-10-04T11:15:00Z'));
    expect(p.end).toEqual(now);
    expect(p.behind).toBe(false);
  });

  it('a connection that was away catches up one window per poll, and says it is behind', () => {
    const p = planWindow(INDIAMART, at('2026-09-20T00:00:00Z'), now, null);
    expect(p.start).toEqual(at('2026-09-19T23:30:00Z'));
    expect(p.end.getTime() - p.start.getTime()).toBe(518_400 * 1000);
    expect(p.behind).toBe(true);
    // The next one resumes from the end of this one.
    const next = planWindow(INDIAMART, p.end, now, null);
    expect(next.start.getTime()).toBe(p.end.getTime() - 1800 * 1000);
    expect(next.end.getTime()).toBeGreaterThan(p.end.getTime());
  });

  it("never reaches back beyond the portal's history, and says it had to", () => {
    const p = planWindow(INDIAMART, at('2025-01-01T00:00:00Z'), now, null);
    expect(p.clamped).toBe(true);
    // 365 days less the margin of an hour.
    expect(now.getTime() - p.start.getTime()).toBe((31_536_000 - 3600) * 1000);
    expect(p.end.getTime() - p.start.getTime()).toBe(518_400 * 1000);
  });

  it('a window narrower than the recipe is honoured, and never wider', () => {
    const narrow = planWindow(INDIAMART, at('2026-09-20T00:00:00Z'), now, 3600);
    expect(narrow.end.getTime() - narrow.start.getTime()).toBe(3600 * 1000);
    const wide = planWindow(INDIAMART, at('2026-09-20T00:00:00Z'), now, 99_999_999);
    expect(wide.end.getTime() - wide.start.getTime()).toBe(518_400 * 1000);
  });

  it('a cursor in the future (a clock set back) is read as now, and a cursor at now has nothing to ask', () => {
    const future = planWindow(
      { ...INDIAMART, overlapSeconds: 0 },
      at('2026-10-05T00:00:00Z'),
      now,
      null,
    );
    expect(future.empty).toBe(true);
    const caughtUp = planWindow({ ...INDIAMART, overlapSeconds: 0 }, now, now, null);
    expect(caughtUp.empty).toBe(true);
    expect(caughtUp.behind).toBe(false);
  });
});

describe('narrowing and widening the window', () => {
  it('halves, down to the smallest span that still moves forward past the overlap, then says it cannot', () => {
    expect(narrowerSpan(INDIAMART, null)).toBe(259_200);
    expect(narrowerSpan(INDIAMART, 259_200)).toBe(129_600);
    let span: number | null = 518_400;
    const seen: number[] = [];
    while (span !== null) {
      seen.push(span);
      span = narrowerSpan(INDIAMART, span);
    }
    // 1800 s of overlap needs a window of more than 3600 s to move forward.
    expect(seen[seen.length - 1]!).toBeGreaterThan(3660);
    expect(narrowerSpan(INDIAMART, 3700)).toBeNull();
  });

  it('grows back toward the recipe width after a poll that fitted, and then returns to its own width', () => {
    expect(widerSpan(INDIAMART, null)).toBeNull();
    expect(widerSpan(INDIAMART, 100_000)).toBe(200_000);
    expect(widerSpan(INDIAMART, 400_000)).toBeNull();
  });
});
