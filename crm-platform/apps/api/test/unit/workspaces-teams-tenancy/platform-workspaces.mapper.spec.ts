import { describe, expect, it } from 'vitest';
import {
  balanceToMinor,
  daySpine,
  decodeHubCursor,
  deliveredPct,
  effectiveLimits,
  encodeHubCursor,
  fillSeries,
  hubCan,
  hubHealth,
  toHubRow,
  type HubContext,
  type HubRawRow,
  type PageFacts,
} from '../../../src/modules/workspaces-teams-tenancy/platform-workspaces.mapper';
import { Fx } from '../../../src/modules/dashboards-analytics-charts';

const NOW = new Date('2026-10-06T12:00:00.000Z');
const DAY = 86_400_000;

const raw = (over: Partial<HubRawRow> = {}): HubRawRow => ({
  id: 7,
  uuid: '5afcfeda-11ce-4e2f-bb97-5de36d09834e',
  name: 'Alpha',
  slug: 'alpha',
  status: 'active',
  plan: 'pro_m',
  created_at: new Date(NOW.getTime() - 30 * DAY),
  created_at_iso: '',
  state: 'paid_active',
  trial_ends_at: null,
  plan_ends_at: new Date(NOW.getTime() + 20 * DAY),
  overrides: {},
  platform_owned: false,
  plan_found: true,
  plan_name: 'Pro',
  plan_limits: { monthly_messages: 1000, users: 5, contacts: 0, devices: 2 },
  amount: '120.00',
  offer_amount: null,
  billing_unit: 'years',
  billing_duration: 1,
  plan_currency: 'USD',
  is_free: false,
  unit: 'USD',
  balance: '12.3400',
  low: false,
  provider_key: null,
  provider_label: null,
  owner_uuid: null,
  owner_name: null,
  owner_email: null,
  owner_phone: null,
  ...over,
});

const facts = (over: Partial<PageFacts> = {}): PageFacts => ({
  numbers: new Map(),
  flags: new Map(),
  messages7d: new Map(),
  lastActive: new Map(),
  ...over,
});

const ctx: HubContext = {
  now: NOW,
  fx: new Fx('USD', new Map([['USD', 1]])),
  freeLimits: { monthly_messages: 50, users: 1, contacts: 100, devices: 1 },
  provider: {
    fallbackKey: 'meta',
    fallbackSource: 'platform_setting',
    labels: new Map([['meta', 'Meta Cloud API (direct)']]),
  },
};

describe('balanceToMinor', () => {
  it('turns numeric text into minor units without float error', () => {
    expect(balanceToMinor('12.3400')).toBe('1234');
    expect(balanceToMinor('0.1000')).toBe('10');
    expect(balanceToMinor('1234567890123456.7890')).toBe('123456789012345678');
    expect(balanceToMinor('5')).toBe('500');
    expect(balanceToMinor(null)).toBe('0');
  });
});

describe('effectiveLimits', () => {
  it('uses the plan, and 0 means unlimited (null)', () => {
    expect(effectiveLimits(raw(), null)).toEqual({
      monthlyMessages: 1000,
      users: 5,
      contacts: null,
      devices: 2,
      overridden: false,
    });
  });
  it('an override beats the plan; 0 and -1 mean unlimited', () => {
    const l = effectiveLimits(
      raw({ overrides: { limits: { users: 50, devices: -1, monthly_messages: 0 }, features: {} } }),
      null,
    );
    expect([l.users, l.devices, l.monthlyMessages, l.overridden]).toEqual([50, null, null, true]);
  });
  it('a feature override alone marks the workspace overridden', () => {
    expect(
      effectiveLimits(raw({ overrides: { limits: {}, features: { automation: true } } }), null)
        .overridden,
    ).toBe(true);
  });
  it('platform-owned and plan-less workspaces are unlimited', () => {
    expect(effectiveLimits(raw({ platform_owned: true }), null).users).toBeNull();
    expect(effectiveLimits(raw({ plan_found: false }), null).users).toBeNull();
  });
  it('a lapsed paid plan carries the free plan caps', () => {
    const l = effectiveLimits(raw({ state: 'paid_lapsed' }), ctx.freeLimits);
    expect([l.monthlyMessages, l.users, l.contacts]).toEqual([50, 1, 100]);
  });
});

describe('hubHealth', () => {
  const base = {
    status: 'active',
    suspendedBy: [],
    createdAt: new Date(NOW.getTime() - 30 * DAY),
    now: NOW,
  };
  it('suspended beats everything', () => {
    expect(hubHealth({ ...base, status: 'suspended', messages7d: 900 })).toBe('suspended');
    expect(hubHealth({ ...base, suspendedBy: ['fraud'], messages7d: 900 })).toBe('suspended');
  });
  it('new: under 7 days old with no outbound messages', () => {
    const fresh = new Date(NOW.getTime() - 2 * DAY);
    expect(hubHealth({ ...base, createdAt: fresh, messages7d: 0 })).toBe('new');
    expect(hubHealth({ ...base, createdAt: fresh, messages7d: 3 })).toBe('low');
    expect(hubHealth({ ...base, messages7d: 0 })).toBe('idle');
  });
  it('the dashboard thresholds: 500 good, 50 active, above 0 low', () => {
    expect(hubHealth({ ...base, messages7d: 500 })).toBe('good');
    expect(hubHealth({ ...base, messages7d: 50 })).toBe('active');
    expect(hubHealth({ ...base, messages7d: 1 })).toBe('low');
  });
});

describe('toHubRow', () => {
  it('maps a paying workspace: mrr, wallet string, provider fallback, validity', () => {
    const row = toHubRow(
      raw(),
      facts({
        numbers: new Map([[7, 2]]),
        messages7d: new Map([[7, 60]]),
        lastActive: new Map([[7, NOW]]),
      }),
      ctx,
    );
    expect(row.mrr).toBe('10.00'); // 120 a year
    expect(row.wallet).toEqual({ currency: 'USD', balanceMinor: '1234', low: false });
    expect(row.provider).toEqual({
      key: 'meta',
      name: 'Meta Cloud API (direct)',
      source: 'platform_setting',
    });
    expect(row.numbers).toBe(2);
    expect(row.health).toBe('active');
    expect(row.lastActiveAt).toBe(NOW.toISOString());
    expect(row.validity.state).toBe('paid_active');
    expect(row.owner).toBeNull();
  });
  it('a provider override wins and carries its label', () => {
    const row = toHubRow(raw({ provider_key: 'acme', provider_label: 'Acme BSP' }), facts(), ctx);
    expect(row.provider).toEqual({ key: 'acme', name: 'Acme BSP', source: 'override' });
  });
  it('free, trial, lapsed and platform-owned workspaces carry no MRR', () => {
    for (const over of [
      { state: 'free' as const },
      { state: 'free_trial' as const },
      { state: 'paid_lapsed' as const },
      { platform_owned: true },
    ])
      expect(toHubRow(raw(over), facts(), ctx).mrr).toBe('0.00');
  });
  it('suspension flags come from the page facts', () => {
    const row = toHubRow(
      raw({ status: 'suspended' }),
      facts({ flags: new Map([[7, ['frozen']]]) }),
      ctx,
    );
    expect(row.suspendedBy).toEqual(['frozen']);
    expect(row.health).toBe('suspended');
  });
});

describe('detail helpers', () => {
  it('the spine is 30 UTC days ending today and the series is zero-filled', () => {
    const spine = daySpine(NOW, 30);
    expect(spine).toHaveLength(30);
    expect(spine[29]).toBe('2026-10-06');
    expect(spine[0]).toBe('2026-09-07');
    const s = fillSeries(spine, [{ day: '2026-10-05', sent: 10, delivered: 8 }]);
    expect(s[28]).toEqual({ day: '2026-10-05', sent: 10, delivered: 8 });
    expect(s[0]).toEqual({ day: '2026-09-07', sent: 0, delivered: 0 });
  });
  it('deliveredPct is null with nothing sent, else one decimal', () => {
    expect(deliveredPct(fillSeries(daySpine(NOW, 3), []))).toBeNull();
    expect(deliveredPct([{ day: 'a', sent: 3, delivered: 2 }])).toBe(66.7);
  });
  it('can: permission keys for the row actions, super admin tier for plan and wallet', () => {
    const held = new Set(['platform.workspace.suspend', 'platform.whatsapp_providers.manage']);
    expect(hubCan(held, 'support')).toEqual({
      suspend: true,
      unsuspend: false,
      impersonate: false,
      editPlan: false,
      manageProvider: true,
      adjustWallet: false,
    });
    const sa = hubCan(new Set(), 'super_admin');
    expect([sa.editPlan, sa.adjustWallet, sa.suspend]).toEqual([true, true, false]);
  });
});

describe('cursor', () => {
  it('round-trips and is bound to its sort order', () => {
    const c = encodeHubCursor({ sort: 'name', v: 'alpha', id: 7 });
    expect(decodeHubCursor(c, 'name')).toEqual({ sort: 'name', v: 'alpha', id: 7 });
    expect(decodeHubCursor(c, 'created')).toBeNull();
  });
  it('keeps a null sort value (never active) and rejects garbage', () => {
    const c = encodeHubCursor({ sort: 'last_active', v: null, id: 3 });
    expect(decodeHubCursor(c, 'last_active')).toEqual({ sort: 'last_active', v: null, id: 3 });
    expect(decodeHubCursor('not-a-cursor', 'created')).toBeNull();
    expect(decodeHubCursor(undefined, 'created')).toBeNull();
  });
});
