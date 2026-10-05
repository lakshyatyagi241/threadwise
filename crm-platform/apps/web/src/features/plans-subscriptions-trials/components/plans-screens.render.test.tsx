import { describe, expect, it } from 'vitest';
import { PLAN_LIMIT_KEYS, type BillingPlan, type BillingUsagePanelResponse } from '@crm/contracts';
import { renderAccount } from '@/features/auth-registration-security/account/render-test-utils';
import { BILLING_KEYS } from '../api';
import { CompareTable } from './compare-table';
import { PlanAddons } from './plan-addons';
import { PlanCard } from './plan-card';
import { UsagePanel } from './usage-panel';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const addon = (n: number, name: string, owned = false) => ({
  id: ID(n),
  packSlug: `mkt_${name.toLowerCase()}`,
  app: { id: ID(n + 100), slug: name.toLowerCase(), name },
  price: { amount: '9.00', currency: 'USD', period: { unit: 'months' as const, count: 1 } },
  owned,
});

const usage = (over: Partial<BillingUsagePanelResponse> = {}): BillingUsagePanelResponse => ({
  planSlug: 'growth',
  planName: 'Growth',
  validity: {
    state: 'paid_active',
    trialEndsAt: null,
    planEndsAt: null,
    daysLeft: null,
    renewalWindow: false,
  },
  meters: PLAN_LIMIT_KEYS.map((key) => ({
    key,
    used: key === 'contacts' ? 90 : key === 'devices' ? 5 : 0,
    limit: key === 'contacts' ? 100 : key === 'devices' ? 5 : 0,
    percent: key === 'contacts' ? 90 : key === 'devices' ? 100 : null,
    window: 'total' as const,
  })),
  features: [
    { key: 'automation', enabled: true },
    { key: 'calling', enabled: false },
  ],
  cycleResetsAt: '2026-11-01T00:00:00.000Z',
  visibleAddons: [addon(1, 'Appointments', true), addon(2, 'Dialer')],
  ...over,
});

const plan = (over: Partial<BillingPlan>): BillingPlan =>
  ({
    slug: 'p',
    name: 'Plan',
    subtitle: null,
    kind: 'paid',
    current: false,
    highlighted: false,
    lifetime: false,
    action: 'choose',
    via: 'checkout',
    ctaLabel: 'Get started',
    price: {
      amount: '10.00',
      offerAmount: null,
      currency: 'USD',
      period: { unit: 'months', count: 1 },
    },
    yearly: null,
    limits: {},
    features: {},
    visibleAddons: [],
    ...over,
  }) as unknown as BillingPlan;

for (const locale of ['en', 'ar'] as const) {
  describe(`usage panel (${locale})`, () => {
    const html = () =>
      renderAccount(<UsagePanel />, { locale, seed: [[BILLING_KEYS.usage, usage()]] });

    it('groups the limits, opens capped groups and drops groups with nothing to show', () => {
      const out = html();
      expect(out).toMatch(/data-testid="limit-group-workspace" data-open="true"/);
      // messaging has only unlimited limits: out of the way until "show all"
      expect(out).not.toContain('data-testid="limit-group-messaging"');
      expect(out).toContain('data-testid="meter-contacts"');
      expect(out).not.toContain('data-testid="meter-tags"');
    });

    it('colours the bars: warning at 90% and danger when full', () => {
      const out = html();
      expect(out).toMatch(/data-testid="meter-contacts" data-tone="warning"/);
      expect(out).toMatch(/data-testid="meter-devices" data-tone="danger"/);
    });

    it('hides unlimited limits behind a toggle', () => {
      const out = html();
      expect(out).toContain('data-testid="limits-toggle"');
      expect(out).toContain('aria-pressed="false"');
    });

    it('lists the add-ons of the plan: owned badge, buy link to the Marketplace app', () => {
      const out = html();
      expect(out).toContain('data-testid="plan-addon-appointments"');
      expect(out).toContain('data-owned="true"');
      expect(out).toContain('href="/marketplace/app/dialer"');
      expect(out).not.toContain('href="/marketplace/app/appointments"');
    });

    it('hides the add-ons section when the plan offers none', () => {
      const out = renderAccount(<UsagePanel />, {
        locale,
        seed: [[BILLING_KEYS.usage, usage({ visibleAddons: [] })]],
      });
      expect(out).not.toContain('data-testid="plan-addons"');
    });

    it('still renders a limit the payload has no counter for', () => {
      const u = usage();
      u.meters = u.meters.filter((m) => m.key !== 'contacts');
      const out = renderAccount(<UsagePanel />, { locale, seed: [[BILLING_KEYS.usage, u]] });
      expect(out).toContain('data-testid="meter-contacts"');
    });
  });

  describe(`compare table (${locale})`, () => {
    const a = plan({
      slug: 'a',
      name: 'Alpha',
      limits: { contacts: 100, api_rate_limit_per_minute: 0 } as never,
      features: { automation: true } as never,
      visibleAddons: [addon(1, 'Appointments')],
    });
    const b = plan({
      slug: 'b',
      name: 'Beta',
      current: true,
      limits: { contacts: 0, api_rate_limit_per_minute: 0 } as never,
      features: { automation: true, invoicing: true } as never,
      visibleAddons: [addon(1, 'Appointments'), addon(2, 'Dialer')],
    });

    it('draws group headers, the new rows, an add-ons group, a scroll container and a sticky first column', () => {
      const out = renderAccount(<CompareTable plans={[a, b]} />, { locale });
      expect(out).toContain('data-testid="compare-group-limits-workspace"');
      expect(out).toContain('data-testid="compare-group-features-advanced"');
      expect(out).toContain('data-testid="compare-group-addons"');
      expect(out).toContain(`data-testid="compare-row-addon-${ID(102)}"`);
      expect(out).toContain('data-testid="compare-row-limit-api_rate_limit_per_minute"');
      expect(out).toContain('overflow-auto');
      expect(out).toContain('sticky start-0');
      expect(out).toContain('data-current="true"');
    });

    it('renders nothing for a single plan', () => {
      expect(renderAccount(<CompareTable plans={[a]} />, { locale })).toBe('');
    });
  });
}

describe('plan card', () => {
  it('keeps a short list with a Show all expander when the plan carries many limits', () => {
    const many = plan({
      limits: Object.fromEntries(PLAN_LIMIT_KEYS.map((k) => [k, 5])) as never,
      features: { automation: true, invoicing: true } as never,
    });
    const out = renderAccount(
      <PlanCard plan={many} canManage busy={false} period="monthly" onSwitch={() => undefined} />,
    );
    expect(out.match(/<li /g)).toHaveLength(7);
    expect(out).toContain('aria-expanded="false"');
  });
});

describe('plan add-ons', () => {
  it('renders nothing for an empty list', () => {
    expect(renderAccount(<PlanAddons addons={[]} />)).toBe('');
  });
});
