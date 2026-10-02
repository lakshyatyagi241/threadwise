import { describe, expect, it } from 'vitest';
import { computeWindow, formatWindowLeft, rowWindowChip, WINDOW_SOON_MS } from './window';

const NOW = Date.parse('2026-10-02T12:00:00.000Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();
const H = 3_600_000;

describe('computeWindow', () => {
  it('has no rule on a channel without a window', () => {
    expect(computeWindow({ open: true, expiresAt: at(H) }, null, NOW, NOW).state).toBe('none');
  });

  it('has no rule before the thread is loaded', () => {
    expect(computeWindow(null, 24, NOW, NOW).state).toBe('none');
  });

  it('is open with a countdown while more than three hours remain', () => {
    const w = computeWindow({ open: true, expiresAt: at(10 * H) }, 24, NOW, NOW);
    expect(w).toMatchObject({ state: 'open', msLeft: 10 * H });
  });

  it('turns to "soon" under three hours', () => {
    const w = computeWindow({ open: true, expiresAt: at(WINDOW_SOON_MS - 1) }, 24, NOW, NOW);
    expect(w.state).toBe('soon');
  });

  it('is closed when the server says closed, whatever the clock says', () => {
    const w = computeWindow({ open: false, expiresAt: at(5 * H) }, 24, NOW, NOW);
    expect(w).toMatchObject({ state: 'closed', msLeft: null });
  });

  it('closes by itself when an open window runs out after it was read', () => {
    const fetchedAt = NOW - 2 * H;
    const w = computeWindow({ open: true, expiresAt: at(-60_000) }, 24, NOW, fetchedAt);
    expect(w.state).toBe('closed');
  });

  it('keeps a forced-open window open though its natural time has passed', () => {
    const w = computeWindow({ open: true, expiresAt: at(-5 * H) }, 24, NOW, NOW);
    expect(w.state).toBe('open');
  });

  it('has no countdown when the customer never wrote', () => {
    expect(computeWindow({ open: true, expiresAt: null }, 24, NOW, NOW).state).toBe('none');
  });
});

describe('formatWindowLeft', () => {
  it('splits hours and minutes', () => {
    expect(formatWindowLeft(3 * H + 20 * 60_000)).toEqual({ hours: 3, minutes: 20 });
    expect(formatWindowLeft(45 * 60_000)).toEqual({ hours: 0, minutes: 45 });
    expect(formatWindowLeft(-5)).toEqual({ hours: 0, minutes: 0 });
  });
});

describe('rowWindowChip', () => {
  it('shows only when closing soon or closed', () => {
    expect(rowWindowChip(at(10 * H), NOW)).toBeNull();
    expect(rowWindowChip(at(H), NOW)).toEqual({ state: 'soon', msLeft: H });
    expect(rowWindowChip(at(-1), NOW)).toEqual({ state: 'closed', msLeft: null });
    expect(rowWindowChip(null, NOW)).toBeNull();
  });
});
