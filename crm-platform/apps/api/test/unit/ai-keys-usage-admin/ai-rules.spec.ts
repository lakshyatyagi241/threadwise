import { describe, expect, it } from 'vitest';
import {
  byokAllowed,
  capRequestedTokens,
  capView,
  clampTokens,
  estimateCostUsd,
  fillDaily,
  lastFour,
  mergeExtras,
  monthStart,
  monthlyTokenLimit,
  parseExtras,
  pickSource,
  usageRange,
  windowStart,
  type EntitlementFacts,
} from '../../../src/modules/ai-keys-usage-admin/ai-rules';

const facts = (over: Partial<EntitlementFacts> = {}): EntitlementFacts => ({
  platformOwned: false,
  planKnown: true,
  overrides: {},
  planLimits: {},
  planFeatures: {},
  ...over,
});

describe('extras (WD-AIADM-002, 009)', () => {
  it('reads the ceiling and the extra models', () => {
    expect(parseExtras('{"max_tokens":4096,"models":["a","b"]}')).toEqual({
      maxTokens: 4096,
      models: ['a', 'b'],
      text: {},
    });
  });

  it('reads a string ceiling as WaDesk stored it, and a non-numeric one as no ceiling', () => {
    expect(parseExtras('{"max_tokens":"4096"}').maxTokens).toBe(4096);
    expect(parseExtras('{"max_tokens":"lots"}').maxTokens).toBeNull();
    expect(parseExtras('{"max_tokens":0}').maxTokens).toBeNull();
  });

  it('never throws on a value that is not the expected shape', () => {
    for (const raw of [null, undefined, '', '[]', 'nope', '{"models":"x"}', '42']) {
      expect(parseExtras(raw)).toEqual({ maxTokens: null, models: [], text: {} });
    }
  });

  it('stores the card text field (Organization ID) under its key, and blank clears it', () => {
    const stored = { maxTokens: null, models: [], text: {} };
    const set = mergeExtras(stored, { textExtra: 'org-1' }, true, 'organization');
    expect(JSON.parse(set.json)).toEqual({ organization: 'org-1' });
    expect(mergeExtras(set.next, { textExtra: '' }, true, 'organization').json).toBe('{}');
    expect(mergeExtras(stored, { textExtra: 'x' }, true, null).json).toBe('{}');
  });

  it('keeps what a request leaves out and writes the ceiling only where the card has the field', () => {
    const stored = { maxTokens: 1000, models: ['m1'], text: {} };
    expect(mergeExtras(stored, {}, true).next).toEqual(stored);
    expect(mergeExtras(stored, { maxTokens: 2000 }, true).next.maxTokens).toBe(2000);
    expect(mergeExtras(stored, { maxTokens: 2000 }, false).next.maxTokens).toBe(1000);
    expect(mergeExtras(stored, { maxTokens: null }, true).next.maxTokens).toBeNull();
    expect(mergeExtras(stored, { extraModels: [' x ', 'x', 'y'] }, true).next.models).toEqual([
      'x',
      'y',
    ]);
  });

  it('stores an empty object when nothing is set, and round-trips what it stores', () => {
    expect(mergeExtras({ maxTokens: null, models: [], text: {} }, {}, true).json).toBe('{}');
    const { json, next } = mergeExtras(
      { maxTokens: null, models: [], text: {} },
      { maxTokens: 5 },
      true,
    );
    expect(parseExtras(json)).toEqual(next);
  });
});

describe('the platform output ceiling lowers a request, never raises it (WD-AIADM-009)', () => {
  it('lowers 4000 to a ceiling of 1000', () => expect(capRequestedTokens(4000, 1000)).toBe(1000));
  it('leaves 512 alone when there is no ceiling', () =>
    expect(capRequestedTokens(512, null)).toBe(512));
  it('leaves 300 alone under a ceiling of 1000', () =>
    expect(capRequestedTokens(300, 1000)).toBe(300));
  it('ignores a non-positive ceiling', () => expect(capRequestedTokens(300, 0)).toBe(300));
});

describe('secrets', () => {
  it('shows the last four of a key and nothing of a short one', () => {
    expect(lastFour('sk-abcdefgh1234')).toBe('1234');
    expect(lastFour('short')).toBeNull();
  });
});

describe('BYOK entitlement (WD-AIADM-010)', () => {
  it('is off by default', () => expect(byokAllowed(facts())).toBe(false));
  it('follows the plan flag', () =>
    expect(byokAllowed(facts({ planFeatures: { allow_byok_ai_keys: true } }))).toBe(true));
  it('lets a per-workspace override beat the plan, either way', () => {
    expect(
      byokAllowed(
        facts({
          planFeatures: { allow_byok_ai_keys: true },
          overrides: { features: { allow_byok_ai_keys: false } },
        }),
      ),
    ).toBe(false);
    expect(byokAllowed(facts({ overrides: { features: { allow_byok_ai_keys: true } } }))).toBe(
      true,
    );
  });
  it('never gates the platform-owned workspace', () =>
    expect(byokAllowed(facts({ platformOwned: true }))).toBe(true));
  it('does not lock a workspace whose plan has no catalogue row', () =>
    expect(byokAllowed(facts({ planKnown: false }))).toBe(true));
});

describe('monthly token cap (WD-AIADM-017, 018)', () => {
  it('has none by default and for the platform-owned workspace', () => {
    expect(monthlyTokenLimit(facts())).toBeNull();
    expect(
      monthlyTokenLimit(facts({ platformOwned: true, planLimits: { ai_token_limit_monthly: 5 } })),
    ).toBeNull();
  });
  it('reads the plan cap; zero means unlimited', () => {
    expect(monthlyTokenLimit(facts({ planLimits: { ai_token_limit_monthly: 1000 } }))).toBe(1000);
    expect(monthlyTokenLimit(facts({ planLimits: { ai_token_limit_monthly: 0 } }))).toBeNull();
  });
  it('lets an override win, with -1 meaning unlimited', () => {
    const planLimits = { ai_token_limit_monthly: 1000 };
    expect(
      monthlyTokenLimit(
        facts({ planLimits, overrides: { limits: { ai_token_limit_monthly: 50 } } }),
      ),
    ).toBe(50);
    expect(
      monthlyTokenLimit(
        facts({ planLimits, overrides: { limits: { ai_token_limit_monthly: -1 } } }),
      ),
    ).toBeNull();
  });
  it('meters percent clamped to 100 and flags reaching the cap', () => {
    expect(capView(250, 1000)).toEqual({ used: 250, limit: 1000, percent: 25, reached: false });
    expect(capView(1000, 1000)).toMatchObject({ percent: 100, reached: true });
    expect(capView(5000, 1000)).toMatchObject({ percent: 100, reached: true });
    expect(capView(99, null)).toEqual({ used: 99, limit: null, percent: 0, reached: false });
  });
});

describe('key choice', () => {
  it('prefers the workspace key only when allowed and present', () => {
    expect(pickSource(true, true, true)).toBe('workspace');
    expect(pickSource(false, true, true)).toBe('admin');
    expect(pickSource(true, false, true)).toBe('admin');
    expect(pickSource(true, true, false)).toBe('workspace');
    expect(pickSource(false, true, false)).toBe('none');
    expect(pickSource(true, false, false)).toBe('none');
  });
});

describe('windows and figures (WD-AIADM-019, 020, 025)', () => {
  const now = new Date('2026-10-02T15:30:00Z');

  it('starts the 7-day window at UTC midnight six days ago, so today is the last bucket', () => {
    expect(windowStart('7d', now).toISOString()).toBe('2026-09-26T00:00:00.000Z');
    expect(windowStart('30d', now).toISOString()).toBe('2026-09-03T00:00:00.000Z');
    expect(windowStart('1y', now).toISOString()).toBe('2025-10-03T00:00:00.000Z');
  });

  it('resolves a custom range to inclusive UTC days, and a preset to a window ending today', () => {
    const r = usageRange({ window: '30d', from: '2026-09-01', to: '2026-09-10' }, now);
    expect(r.window).toBe('custom');
    expect(r.days).toBe(10);
    expect(r.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(r.until.toISOString()).toBe('2026-09-11T00:00:00.000Z');
    const p = usageRange({ window: '7d' }, now);
    expect([p.window, p.days, p.to]).toEqual(['7d', 7, '2026-10-02']);
    expect(p.until.toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });

  it('starts the cap month at the first of the month', () => {
    expect(monthStart(now).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('fills every day of the window, zero where nothing was spent', () => {
    const from = windowStart('7d', now);
    const out = fillDaily([{ date: '2026-09-28', tokens: 50 }], from, 7);
    expect(out).toHaveLength(7);
    expect(out[0]).toEqual({ date: '2026-09-26', tokens: 0 });
    expect(out[2]).toEqual({ date: '2026-09-28', tokens: 50 });
    expect(out[6]!.date).toBe('2026-10-02');
  });

  it('estimates dollars per provider at blended rates, as a two-place string', () => {
    expect(estimateCostUsd([])).toBe('0.00');
    // 1,000,000 openai tokens = $5.00; 500,000 anthropic = $3.00
    expect(
      estimateCostUsd([
        { provider: 'openai', tokens: 1_000_000 },
        { provider: 'anthropic', tokens: 500_000 },
      ]),
    ).toBe('8.00');
    // an unlisted provider falls to the default 0.004 per 1K
    expect(estimateCostUsd([{ provider: 'cohere', tokens: 1_000_000 }])).toBe('4.00');
    // xai is priced as grok (WaDesk listed only the old slug)
    expect(estimateCostUsd([{ provider: 'xai', tokens: 1_000_000 }])).toBe('5.00');
    expect(estimateCostUsd([{ provider: 'OpenAI', tokens: 1234 }])).toBe('0.01');
  });

  it('clamps token counts to whole non-negative numbers within the column', () => {
    expect(clampTokens(-5)).toBe(0);
    expect(clampTokens(Number.NaN)).toBe(0);
    expect(clampTokens(12.9)).toBe(12);
    expect(clampTokens(1e12)).toBe(2_147_483_647);
  });
});
