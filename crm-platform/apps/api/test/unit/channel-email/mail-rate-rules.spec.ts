import { describe, expect, it } from 'vitest';
import {
  effectiveSendLimit,
  slidingWindow,
  waitWords,
} from '../../../src/modules/channel-email/mail-rate-rules';

const H = 3_600_000;

describe('TW-MAIL-032: sliding window math', () => {
  it('allows below the limit and counts only the hits inside the window', () => {
    const now = 10 * H;
    expect(slidingWindow([], now, H, 3)).toEqual({ allowed: true, count: 0, retryAfterMs: 0 });
    expect(slidingWindow([now - 2 * H, now - 100], now, H, 3).count).toBe(1);
  });

  it('refuses at the limit and says when the oldest hit leaves the window', () => {
    const now = 10 * H;
    const hits = [now - 50 * 60_000, now - 30 * 60_000, now - 10 * 60_000];
    const v = slidingWindow(hits, now, H, 3);
    expect(v.allowed).toBe(false);
    expect(v.retryAfterMs).toBe(10 * 60_000);
  });

  it('frees a slot exactly when the window passes, and other limits are independent', () => {
    const t0 = 5 * H;
    const hits = [t0, t0 + 1_000];
    expect(slidingWindow(hits, t0 + H - 1, H, 2).allowed).toBe(false);
    expect(slidingWindow(hits, t0 + H + 1, H, 2).allowed).toBe(true);
    expect(slidingWindow(hits, t0 + 2_000, H, 5).allowed).toBe(true);
  });

  it('the mailbox setting beats the platform default', () => {
    expect(effectiveSendLimit(7, 100)).toBe(7);
    expect(effectiveSendLimit(null, 100)).toBe(100);
  });

  it('words a wait for people', () => {
    expect(waitWords(30_000)).toBe('30 seconds');
    expect(waitWords(12 * 60_000)).toBe('12 minutes');
    expect(waitWords(3 * H)).toBe('3 hours');
  });
});
