import { describe, expect, it } from 'vitest';
import {
  barWidth,
  eventRows,
  formatCreated,
  formatTime,
  funnel,
  limitId,
  parseTab,
  rowTone,
  tiles,
  pillTone,
} from './detail-model';

describe('detail model', () => {
  it('tabs fall back to overview', () => {
    expect(parseTab('failures')).toBe('failures');
    expect(parseTab('nope')).toBe('overview');
    expect(parseTab(null)).toBe('overview');
  });

  it('times are shown in the broadcast zone; a bad zone or a missing time is safe', () => {
    expect(formatTime('2026-10-02T10:00:09Z', 'Asia/Kolkata')).toBe('Oct 2, 15:30:09');
    expect(formatTime('2026-10-02T10:00:09Z', 'Not/AZone')).toBe('Oct 2, 10:00:09');
    expect(formatTime(null, 'UTC')).toBe('—');
    expect(formatCreated('2026-10-02T10:00:00Z', 'UTC')).toBe('Oct 2, 2026, 10:00');
  });

  it('tones, id limit and bar width', () => {
    expect(['read', 'delivered', 'sent', 'failed', 'pending'].map(rowTone)).toEqual([
      'read',
      'delivered',
      'sent',
      'failed',
      'other',
    ]);
    expect(limitId('wamid.HBgMOTE5ODc2NTQzMjEw')).toBe('wamid.HBgMOTE5OD...');
    expect(limitId('short')).toBe('short');
    expect([-5, 40, 140].map(barWidth)).toEqual([0, 40, 100]);
  });

  it('the header tiles use the audience as the base, read uses delivered, zero is zero', () => {
    const t = tiles({ total: 200, sent: 150, delivered: 100, read: 25, failed: 10, queued: 40 });
    expect(t.pct).toEqual({ sent: 75, delivered: 50, read: 25, failed: 5 });
    expect(tiles({ total: 0, sent: 0, delivered: 0, read: 0, failed: 0, queued: 0 }).pct).toEqual({
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
    });
  });

  it('the funnel starts at the whole audience and lists failed last', () => {
    const rows = funnel({
      counts: { total: 10, sent: 8, delivered: 6, read: 3, failed: 2, queued: 0, clicked: 0 },
      pct: { sent: 80, delivered: 60, read: 50, failed: 20, clicked: 0 },
    });
    expect(rows.map((r) => r.key)).toEqual(['audience', 'sent', 'delivered', 'read', 'failed']);
    expect(rows[0]).toEqual({ key: 'audience', count: 10, pct: 100 });
  });

  it('the four lifecycle rows', () => {
    const rows = eventRows(
      {
        createdAt: '2026-10-02T10:00:00Z',
        scheduledAt: null,
        status: 'completed_with_errors',
        completedAt: '2026-10-02T11:00:00Z',
      },
      'UTC',
    );
    expect(rows.map((r) => r.key)).toEqual(['created', 'scheduledAt', 'status', 'completed']);
    expect(rows[1]!.value).toBe('—');
    expect(rows[2]!.value).toBe('Completed With Errors');
  });
});

describe('detail pill', () => {
  it('green when completed, amber while moving or with errors, quiet for scheduled', () => {
    expect(
      ['completed', 'processing', 'completed_with_errors', 'failed', 'scheduled', 'paused'].map(
        pillTone,
      ),
    ).toEqual(['success', 'warning', 'warning', 'danger', 'neutral', 'neutral']);
  });
});
