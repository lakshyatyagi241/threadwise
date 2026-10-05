import { describe, expect, it } from 'vitest';
import {
  BASE_POLL_MS,
  MAX_POLL_MS,
  clampPos,
  countLabel,
  hidesBell,
  latestMark,
  nextDelay,
  parseDismissal,
  shouldAlert,
  visibility,
} from './logic';

describe('new-message pill (TW-ASHELL-028)', () => {
  it('polls every 15 s, doubles on trouble up to 5 minutes and recovers on success', () => {
    expect(nextDelay(BASE_POLL_MS, 'ok')).toBe(15_000);
    expect(nextDelay(15_000, 'throttled')).toBe(30_000);
    expect(nextDelay(30_000, 'failed')).toBe(60_000);
    expect(nextDelay(MAX_POLL_MS, 'failed')).toBe(MAX_POLL_MS);
    expect(nextDelay(120_000, 'ok')).toBe(15_000);
  });

  it('caps the badge at 99+', () => {
    expect(countLabel(99)).toBe('99');
    expect(countLabel(100)).toBe('99+');
  });

  it('hides at zero, and stays dismissed until a newer message or a larger total', () => {
    expect(visibility(0, 0, null)).toEqual({ show: false, clear: true });
    expect(visibility(3, 10, null)).toEqual({ show: true, clear: false });
    const d = { mark: 10, total: 3 };
    expect(visibility(3, 10, d)).toEqual({ show: false, clear: false });
    expect(visibility(3, 11, d)).toEqual({ show: true, clear: true });
    expect(visibility(4, 10, d)).toEqual({ show: true, clear: true });
  });

  it('alerts only when the total rises after the first poll', () => {
    expect(shouldAlert(null, 5)).toBe(false);
    expect(shouldAlert(2, 3)).toBe(true);
    expect(shouldAlert(3, 3)).toBe(false);
  });

  it('reads the newest message time and tolerates a bad stored value', () => {
    expect(latestMark([{ lastMessageAt: null }, { lastMessageAt: '2026-01-01T00:00:00Z' }])).toBe(
      Date.parse('2026-01-01T00:00:00Z'),
    );
    expect(parseDismissal('nope')).toBeNull();
    expect(parseDismissal('{"mark":1,"total":2}')).toEqual({ mark: 1, total: 2 });
  });

  it('keeps a dragged pill on screen and is absent from the inbox', () => {
    expect(clampPos({ x: -50, y: 5000 }, 800, 600)).toEqual({ x: 8, y: 600 - 44 - 8 });
    expect(hidesBell('/inbox')).toBe(true);
    expect(hidesBell('/inbox/channels')).toBe(true);
    expect(hidesBell('/inboxes')).toBe(false);
  });
});
