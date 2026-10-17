import { describe, expect, it } from 'vitest';
import {
  STREAM_POLICIES,
  isPastLiveWindow,
  monthBounds,
  monthOfPartition,
  partitionName,
} from '../../../src/modules/data-retention/retention-policies';

const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('isPastLiveWindow', () => {
  it('is true only once the month end is liveDays behind now', () => {
    // 2026-10 ends 2026-11-01; 60 days later is 2026-12-31.
    expect(isPastLiveWindow('2026-10', at('2026-12-31'), 60)).toBe(true);
    expect(isPastLiveWindow('2026-10', at('2026-12-30'), 60)).toBe(false);
    // 2026-11 ends 2026-12-01; 60 days later is 2027-01-30.
    expect(isPastLiveWindow('2026-11', at('2026-12-20'), 60)).toBe(false);
    expect(isPastLiveWindow('2026-11', at('2027-01-30'), 60)).toBe(true);
    expect(isPastLiveWindow('2026-11', at('2027-01-29'), 60)).toBe(false);
  });

  it('is true for any month long past, however old', () => {
    expect(isPastLiveWindow('2020-01', at('2026-12-20'), 60)).toBe(true);
  });

  it('is false for the current and a future month, even with no live window', () => {
    expect(isPastLiveWindow('2026-12', at('2026-12-20'), 0)).toBe(false);
    expect(isPastLiveWindow('2027-03', at('2026-12-20'), 0)).toBe(false);
    expect(isPastLiveWindow('2026-11', at('2026-12-20'), 0)).toBe(true);
  });

  it('crosses the year boundary correctly', () => {
    // 2026-12 ends 2027-01-01; 30 days later is 2027-01-31.
    expect(isPastLiveWindow('2026-12', at('2027-01-31'), 30)).toBe(true);
    expect(isPastLiveWindow('2026-12', at('2027-01-30'), 30)).toBe(false);
  });

  it('rejects a bad month or a negative or fractional liveDays', () => {
    expect(() => isPastLiveWindow('2026-13', at('2026-12-20'), 5)).toThrow();
    expect(() => isPastLiveWindow('2026-10', at('2026-12-20'), -5)).toThrow();
    expect(() => isPastLiveWindow('2026-10', at('2026-12-20'), 1.5)).toThrow();
  });
});

describe('monthBounds and partitionName', () => {
  it('gives the half-open UTC range of a month', () => {
    const { from, to } = monthBounds('2026-12');
    expect(from.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('names a partition the way ensure_monthly_partition does', () => {
    expect(partitionName('an_events', '2026-08')).toBe('an_events_202608');
  });

  it('reads the month back from a partition name and ignores anything else', () => {
    expect(monthOfPartition('an_events', 'an_events_202608')).toBe('2026-08');
    expect(monthOfPartition('an_events', 'an_events_default')).toBeNull();
    expect(monthOfPartition('an_events', 'an_events_202613')).toBeNull();
    expect(monthOfPartition('an_events', 'an_events_hour_202608')).toBeNull();
    expect(monthOfPartition('an_events', 'other_202608')).toBeNull();
  });

  it('rejects anything that is not YYYY-MM', () => {
    for (const bad of ['2026-8', '2026-13', '2026-00', '202608', "2026-08'; drop table x;--", '']) {
      expect(() => monthBounds(bad)).toThrow();
      expect(() => partitionName('an_events', bad)).toThrow();
    }
  });
});

describe('STREAM_POLICIES', () => {
  it('registers an_events with the decided windows and no personal link in the archive', () => {
    const p = STREAM_POLICIES.find((s) => s.stream === 'an_events');
    expect(p).toMatchObject({
      partitionKey: 'recorded_at',
      orgColumn: 'org_id',
      liveDays: 60,
      archiveDays: null,
    });
    expect(p?.omitColumns).toContain('contact_id');
  });

  it('uses plain lower-case identifiers only (they are spliced into DDL)', () => {
    for (const p of STREAM_POLICIES) {
      for (const id of [p.stream, p.partitionKey, p.idColumn, p.orgColumn, ...p.omitColumns]) {
        expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });

  it('never omits the columns the export needs to page and to split by workspace', () => {
    for (const p of STREAM_POLICIES) {
      for (const needed of [p.idColumn, p.orgColumn, p.partitionKey]) {
        expect(p.omitColumns).not.toContain(needed);
      }
    }
  });

  it('has one policy per stream', () => {
    const names = STREAM_POLICIES.map((s) => s.stream);
    expect(new Set(names).size).toBe(names.length);
  });
});
