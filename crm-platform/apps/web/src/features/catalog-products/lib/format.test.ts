import { describe, expect, it } from 'vitest';
import { bucket, formatWhen, providerLabel, syncStatus, timeAgo, truncate } from './format';

describe('syncStatus', () => {
  it('reads null as unsynced and the legacy error value as failed', () => {
    expect(syncStatus(null)).toBe('unsynced');
    expect(syncStatus(undefined)).toBe('unsynced');
    expect(syncStatus('pending')).toBe('pending');
    expect(syncStatus('synced')).toBe('synced');
    expect(syncStatus('failed')).toBe('failed');
    expect(syncStatus('error')).toBe('failed');
    expect(syncStatus('weird')).toBe('unsynced');
  });
});

describe('providerLabel', () => {
  it('upper-cases and turns underscores into spaces', () => {
    expect(providerLabel('meta_cloud')).toBe('META CLOUD');
    expect(providerLabel('dialog_360')).toBe('DIALOG 360');
  });
});

describe('truncate and bucket', () => {
  it('cuts to the limit with an ellipsis', () => {
    expect(truncate('short', 60)).toBe('short');
    expect(truncate('x'.repeat(70), 60)).toHaveLength(60);
    expect(truncate('x'.repeat(70), 60).endsWith('…')).toBe(true);
  });
  it('defaults a missing bucket to zero', () => {
    expect(bucket({ synced: 3 }, 'synced')).toBe(3);
    expect(bucket({ synced: 3 }, 'failed')).toBe(0);
  });
});

describe('dates', () => {
  it('formats a send time as month, day and 24-hour time', () => {
    const text = formatWhen('2026-10-02T14:30:00', 'en');
    expect(text).toContain('Oct');
    expect(text).toContain('02');
    expect(text).toContain('14:30');
  });
  it('returns a dash for an invalid date', () => {
    expect(formatWhen('nope', 'en')).toBe('—');
  });
  it('says how long ago', () => {
    const now = new Date('2026-10-02T12:00:00Z');
    expect(timeAgo('2026-10-02T11:55:00Z', now, 'en')).toBe('5 minutes ago');
    expect(timeAgo('2026-10-01T12:00:00Z', now, 'en')).toBe('1 day ago');
    expect(timeAgo('2026-10-02T11:59:59Z', now, 'en')).toBe('1 second ago');
    expect(timeAgo('2026-10-02T11:59:54Z', now, 'en')).toBe('6 seconds ago');
    expect(timeAgo('2026-10-02T12:00:00Z', now, 'en')).toBe('0 seconds ago');
  });
});

describe('formatWhen time zone', () => {
  it('gives a different day and hour for two zones', () => {
    expect(formatWhen('2026-10-02T20:30:00Z', 'en', 'Asia/Kolkata')).toBe('Oct 03, 02:00');
    expect(formatWhen('2026-10-02T20:30:00Z', 'en', 'America/New_York')).toBe('Oct 02, 16:30');
  });
});
