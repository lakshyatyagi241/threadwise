import { describe, expect, it } from 'vitest';
import {
  coverageText,
  coverageTone,
  formatMmSs,
  formatPercent,
  formatRelativeTime,
  kpiAccents,
  mfaCoveragePercent,
  scoreState,
  severityTone,
  webhookState,
} from './kpi';

describe('scoreState', () => {
  it('calls 70+ strong and anything lower attention needed', () => {
    expect(scoreState(70)).toBe('strong');
    expect(scoreState(100)).toBe('strong');
    expect(scoreState(69)).toBe('attention');
    expect(scoreState(50)).toBe('attention');
  });
});

describe('mfaCoveragePercent', () => {
  it('rounds the enrolled share', () => {
    expect(mfaCoveragePercent(1, 3)).toBe(33);
    expect(mfaCoveragePercent(2, 3)).toBe(67);
    expect(mfaCoveragePercent(3, 3)).toBe(100);
  });
  it('is 0 with no operators', () => expect(mfaCoveragePercent(0, 0)).toBe(0));
  it('never exceeds 100', () => expect(mfaCoveragePercent(5, 3)).toBe(100));
});

describe('webhookState', () => {
  it('flags more than 1% for review', () => {
    expect(webhookState(0)).toBe('normal');
    expect(webhookState(1)).toBe('normal');
    expect(webhookState(1.01)).toBe('review');
  });
});

describe('coverageTone', () => {
  it('buckets at 75 / 50 / 25', () => {
    expect(coverageTone(100)).toBe('success');
    expect(coverageTone(75)).toBe('success');
    expect(coverageTone(74)).toBe('primary');
    expect(coverageTone(50)).toBe('primary');
    expect(coverageTone(49)).toBe('warning');
    expect(coverageTone(25)).toBe('warning');
    expect(coverageTone(24)).toBe('danger');
    expect(coverageTone(0)).toBe('danger');
  });
});

describe('severityTone', () => {
  it('maps severity to a badge tone', () => {
    expect(severityTone('high')).toBe('danger');
    expect(severityTone('medium')).toBe('warning');
    expect(severityTone('watch')).toBe('neutral');
  });
});

describe('formatPercent', () => {
  it('drops trailing zeros and keeps two decimals', () => {
    expect(formatPercent(0)).toBe('0');
    expect(formatPercent(2.5)).toBe('2.5');
    expect(formatPercent(33.3333)).toBe('33.33');
    expect(formatPercent(100)).toBe('100');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  it('reads minutes, hours and days', () => {
    expect(formatRelativeTime('2026-10-01T11:55:00Z', now)).toBe('5 minutes ago');
    expect(formatRelativeTime('2026-10-01T10:00:00Z', now)).toBe('2 hours ago');
    expect(formatRelativeTime('2026-09-29T12:00:00Z', now)).toBe('2 days ago');
  });
  it('reads under a minute as now', () =>
    expect(formatRelativeTime('2026-10-01T11:59:40Z', now)).toBe('now'));
});

describe('formatMmSs', () => {
  it('pads seconds and clamps below zero', () => {
    expect(formatMmSs(125)).toBe('2:05');
    expect(formatMmSs(59)).toBe('0:59');
    expect(formatMmSs(0)).toBe('0:00');
    expect(formatMmSs(-4)).toBe('0:00');
  });
});

describe('coverageText', () => {
  it('shows the share alone until the API counts the controls', () => {
    expect(coverageText({ percent: 75 })).toBe('75%');
    expect(coverageText({ percent: 66.667 })).toBe('66.67%');
  });
  it('adds how many controls are on out of how many', () => {
    expect(coverageText({ percent: 75, enabled: 3, total: 4 })).toBe('75% (3/4)');
    expect(coverageText({ percent: 0, enabled: 0, total: 5 })).toBe('0% (0/5)');
  });
  it('needs both counts, a lone one is ignored', () => {
    expect(coverageText({ percent: 50, enabled: 2 })).toBe('50%');
    expect(coverageText({ percent: 50, total: 4 })).toBe('50%');
  });
});

describe('kpiAccents', () => {
  const base = { score: 80, openRisks: 0, warnings24h: 0, webhookFailurePct: 0 };

  it('always outlines the score tile in green', () => {
    expect(kpiAccents(base).score).toEqual({ border: 'success', value: null, note: 'success' });
    expect(kpiAccents({ ...base, score: 50 }).score.border).toBe('success');
    expect(kpiAccents({ ...base, score: 50 }).score.note).toBe('warning');
  });

  it('turns the open-risks tile red from the first risk', () => {
    expect(kpiAccents(base).openRisks).toEqual({ border: null, value: null, note: null });
    expect(kpiAccents({ ...base, openRisks: 1 }).openRisks).toEqual({
      border: 'danger',
      value: 'danger',
      note: 'danger',
    });
  });

  it('gives the warnings tile an amber outline and note from the first warning', () => {
    expect(kpiAccents(base).warnings).toEqual({ border: null, value: null, note: null });
    expect(kpiAccents({ ...base, warnings24h: 3 }).warnings).toEqual({
      border: 'warning',
      value: null,
      note: 'warning',
    });
  });

  it('reads webhook failures amber above 1% and green otherwise, never outlined', () => {
    expect(kpiAccents(base).webhooks).toEqual({ border: null, value: null, note: 'success' });
    expect(kpiAccents({ ...base, webhookFailurePct: 1 }).webhooks.note).toBe('success');
    expect(kpiAccents({ ...base, webhookFailurePct: 1.5 }).webhooks.note).toBe('warning');
  });

  it('leaves blocked attempts and MFA coverage neutral', () => {
    const a = kpiAccents({ ...base, openRisks: 9, warnings24h: 9, webhookFailurePct: 50 });
    expect(a.blocked).toEqual({ border: null, value: null, note: null });
    expect(a.mfa).toEqual({ border: null, value: null, note: null });
  });
});
