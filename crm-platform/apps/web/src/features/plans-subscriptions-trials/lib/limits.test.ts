import {
  PLAN_LIMIT_DEFS,
  PLAN_LIMIT_KEYS,
  type BillingPlan,
  type UsageMeter,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  cardRows,
  cellValue,
  compareSections,
  countUnlimited,
  groupLimits,
  groupedPlanLimits,
  limitPercent,
  limitShown,
  limitTone,
  planLimitRows,
  rowDiffers,
} from './limits';

const meter = (
  key: string,
  used: number,
  limit: number,
  window: 'month' | 'total' = 'total',
): UsageMeter => ({
  key,
  used,
  limit,
  percent: limit > 0 ? Math.min(100, Math.floor((used * 100) / limit)) : null,
  window,
});

/** One meter per registry key, all unlimited, then `over` replaces some. (`teams` is the cap whose 0 is solo: its unlimited is the stand-in value.) */
const meters = (over: Record<string, [number, number]> = {}): UsageMeter[] =>
  PLAN_LIMIT_KEYS.map((k) =>
    meter(k, over[k]?.[0] ?? 0, over[k]?.[1] ?? (k === 'teams' ? 1_000_000 : 0)),
  );

describe('limitTone (normal / warning from 80% / danger at 100%)', () => {
  it('reads the real counts', () => {
    expect(limitTone(0, 100)).toBe('normal');
    expect(limitTone(79, 100)).toBe('normal');
    expect(limitTone(80, 100)).toBe('warning');
    expect(limitTone(99, 100)).toBe('warning');
    expect(limitTone(100, 100)).toBe('danger');
    expect(limitTone(150, 100)).toBe('danger');
    expect(limitTone(8, 10)).toBe('warning');
  });
  it('never alarms for an uncapped limit', () => {
    expect(limitTone(1_000_000, 0)).toBe('normal');
    expect(limitPercent(5, 0)).toBeNull();
  });
  it('clamps the bar width to 0..100', () => {
    expect(limitPercent(250, 100)).toBe(100);
    expect(limitPercent(1, 3)).toBe(33);
  });
});

describe('groupLimits', () => {
  it('lists every registry limit under its group, hiding unlimited ones until "show all"', () => {
    const m = meters({ contacts: [90, 100], devices: [1, 5] });
    const hidden = groupLimits(m, { unofficial: true });
    // the API rate limit (platform default) stays visible in its group
    expect(hidden.map((g) => g.group)).toEqual(['workspace']);
    expect(hidden[0]!.rows.map((r) => r.key)).toEqual([
      'devices',
      'contacts',
      'api_rate_limit_per_minute',
    ]);
    expect(hidden[0]!.rows.find((r) => r.key === 'contacts')!.tone).toBe('warning');
    expect(hidden[0]!.hiddenUnlimited).toBe(
      PLAN_LIMIT_DEFS.filter((d) => d.group === 'workspace').length - 3,
    );

    const all = groupLimits(m, { showAll: true, unofficial: true });
    expect(all.flatMap((g) => g.rows)).toHaveLength(PLAN_LIMIT_KEYS.length);
    expect(all.map((g) => g.group)).toEqual([
      'messaging',
      'workspace',
      'content',
      'sales',
      'integrations',
      'ai',
    ]);
  });

  it('opens only groups with a capped limit by default', () => {
    const g = groupLimits(meters({ monthly_messages: [10, 1000] }), { showAll: true });
    expect(g.find((x) => x.group === 'messaging')!.defaultOpen).toBe(true);
    expect(g.find((x) => x.group === 'workspace')!.defaultOpen).toBe(false);
    expect(g.find((x) => x.group === 'ai')!.defaultOpen).toBe(false);
  });

  it('counts the unlimited limits the toggle would reveal', () => {
    // the API rate limit is "platform default", not unlimited
    expect(countUnlimited(meters(), true)).toBe(PLAN_LIMIT_KEYS.length - 1);
    expect(countUnlimited(meters({ contacts: [1, 10], tags: [1, 10] }), true)).toBe(
      PLAN_LIMIT_KEYS.length - 3,
    );
  });

  it('labels the API rate limit "platform default" at 0, never unlimited', () => {
    const rows = groupLimits(meters()).flatMap((g) => g.rows);
    const api = rows.find((r) => r.key === 'api_rate_limit_per_minute')!;
    expect(api.platformDefault).toBe(true);
    expect(api.unlimited).toBe(false);
    const capped = groupLimits(meters({ api_rate_limit_per_minute: [0, 600] })).flatMap(
      (g) => g.rows,
    );
    expect(capped.find((r) => r.key === 'api_rate_limit_per_minute')!.platformDefault).toBe(false);
  });

  it('shows a limit the usage payload has no counter for as untracked, not as unlimited', () => {
    const without = meters().filter((m) => m.key !== 'tags');
    const tags = groupLimits(without)
      .flatMap((g) => g.rows)
      .find((r) => r.key === 'tags')!;
    expect(tags).toMatchObject({ tracked: false, used: null, unlimited: false });
    expect(countUnlimited(without, true)).toBe(PLAN_LIMIT_KEYS.length - 2);
  });

  it('ignores meters for keys the registry does not know', () => {
    const rows = groupLimits([...meters(), meter('mystery', 1, 2)], { showAll: true }).flatMap(
      (g) => g.rows,
    );
    expect(rows.some((r) => r.key === 'mystery')).toBe(false);
  });
});

const plan = (over: Partial<BillingPlan>): BillingPlan =>
  ({
    slug: 'p',
    name: 'P',
    current: false,
    highlighted: false,
    limits: {},
    features: {},
    visibleAddons: [],
    ...over,
  }) as unknown as BillingPlan;

const addon = (id: string, name: string, owned = false) => ({
  id,
  packSlug: `mkt_${id}`,
  app: { id, slug: id, name },
  price: { amount: '10.00', currency: 'USD', period: { unit: 'months' as const, count: 1 } },
  owned,
});

describe('cardRows', () => {
  it('leads with the headline volumes then capabilities, and keeps the full list for "show all"', () => {
    const p = plan({
      limits: { webhooks: 3, contacts: 0, monthly_messages: 500, devices: 2 } as never,
      features: { automation: true, calling: false, analytics: true } as never,
    });
    const { highlights, all } = cardRows(p, 4, true);
    expect(highlights.map((r) => r.key)).toEqual([
      'monthly_messages',
      'devices',
      'contacts',
      'automation',
    ]);
    expect(all.map((r) => r.key)).toEqual([
      'monthly_messages',
      'devices',
      'contacts',
      'webhooks',
      'automation',
      'analytics',
    ]);
  });
});

describe('the devices limit while the platform has unofficial WhatsApp off', () => {
  const p = plan({
    limits: { webhooks: 3, contacts: 0, monthly_messages: 500, devices: 2 } as never,
    features: { automation: true } as never,
  });

  it('is left out of cards, groups, counts and the compare table unless the switch is on', () => {
    expect(cardRows(p).all.map((r) => r.key)).not.toContain('devices');
    expect(cardRows(p, 7, true).all.map((r) => r.key)).toContain('devices');
    expect(planLimitRows(p).map((r) => r.key)).not.toContain('devices');
    expect(groupedPlanLimits(p).flatMap((g) => g.rows.map((r) => r.key))).not.toContain('devices');
    expect(
      groupLimits(meters({ devices: [1, 5] }), { showAll: true })
        .flatMap((g) => g.rows)
        .map((r) => r.key),
    ).not.toContain('devices');
    expect(countUnlimited(meters())).toBe(PLAN_LIMIT_KEYS.length - 2);
    const keys = (unofficial: boolean) =>
      compareSections([p, plan({ slug: 'z', limits: { devices: 9 } as never })], { unofficial })
        .flatMap((s) => s.rows)
        .map((r) => r.key);
    expect(keys(false)).not.toContain('devices');
    expect(keys(true)).toContain('devices');
  });

  it('keeps every other limit', () => {
    expect(limitShown('devices', false)).toBe(false);
    expect(limitShown('devices', undefined)).toBe(false);
    expect(limitShown('devices', true)).toBe(true);
    expect(limitShown('contacts', false)).toBe(true);
  });
});

describe('groupedPlanLimits', () => {
  it("groups a plan's limits by registry group, dropping empty groups", () => {
    const g = groupedPlanLimits(
      plan({ limits: { monthly_messages: 1, contacts: 0, webhooks: 4 } as never }),
    );
    expect(g.map((x) => [x.group, x.rows.map((r) => r.key)])).toEqual([
      ['messaging', ['monthly_messages']],
      ['workspace', ['contacts']],
      ['integrations', ['webhooks']],
    ]);
  });
});

describe('compareSections', () => {
  const a = plan({
    slug: 'a',
    limits: { contacts: 100, api_rate_limit_per_minute: 0, webhooks: 5 } as never,
    features: { automation: true, invoicing: true } as never,
    visibleAddons: [addon('x1', 'Appointments')],
  });
  const b = plan({
    slug: 'b',
    limits: { contacts: 0, api_rate_limit_per_minute: 0, webhooks: 5 } as never,
    features: { automation: true, invoicing: false } as never,
    visibleAddons: [addon('x1', 'Appointments'), addon('x2', 'Dialer')],
  });

  it('groups limits and capabilities under header sections, then one row per visible add-on', () => {
    const s = compareSections([a, b]);
    expect(s.map((x) => x.id)).toEqual([
      'limits-workspace',
      'limits-integrations',
      'features-messaging',
      'features-advanced',
      'addons',
    ]);
    expect(s.find((x) => x.id === 'addons')!.rows).toEqual([
      { kind: 'addon', key: 'x1', name: 'Appointments' },
      { kind: 'addon', key: 'x2', name: 'Dialer' },
    ]);
  });

  it('marks an add-on present only on the plans that make it visible', () => {
    const row = { kind: 'addon', key: 'x2', name: 'Dialer' } as const;
    expect(cellValue(a, row)).toBe('0');
    expect(cellValue(b, row)).toBe('1');
  });

  it('reads a missing or zero limit as unlimited, except the API rate which is the platform default', () => {
    expect(cellValue(b, { kind: 'limit', key: 'contacts' })).toBe('unlimited');
    expect(cellValue(a, { kind: 'limit', key: 'api_rate_limit_per_minute' })).toBe('default');
    expect(cellValue(a, { kind: 'limit', key: 'contacts' })).toBe('100');
  });

  it('"only differences" drops the rows every plan shares and the sections that empties', () => {
    expect(rowDiffers([a, b], { kind: 'limit', key: 'webhooks' })).toBe(false);
    const s = compareSections([a, b], { onlyDiffering: true });
    expect(s.map((x) => x.id)).toEqual(['limits-workspace', 'features-advanced', 'addons']);
    expect(s.find((x) => x.id === 'addons')!.rows.map((r) => r.key)).toEqual(['x2']);
  });
});

describe('unlimited stand-in values', () => {
  it('shows 1,000,000 and 100,000,000 as unlimited, with no bar', () => {
    const rows = groupLimits([meter('contacts', 0, 1_000_000), meter('flows', 3, 100_000_000)], {
      showAll: true,
    }).flatMap((g) => g.rows);
    for (const r of rows.filter((x) => x.key === 'contacts' || x.key === 'flows')) {
      expect(r.unlimited).toBe(true);
      expect(r.percent).toBeNull();
    }
  });
});
