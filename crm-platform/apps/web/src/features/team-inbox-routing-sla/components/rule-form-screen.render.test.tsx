import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { FeatureAddon } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';
import { PlanFeaturesProvider } from '@/lib/plan-features';

const state = vi.hoisted(() => ({ ruleIds: [] as Array<string | null> }));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => true,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/features/segments/api/lookups', () => ({
  useSegmentCatalog: () => ({ catalog: {}, ready: true, failed: false }),
}));
vi.mock('./contact-conditions', () => ({ ContactConditions: () => null }));
vi.mock('../api/routing', () => ({
  refresh: vi.fn(),
  routingApi: {},
  useAssignees: () => ({ data: { users: [], teams: [] } }),
  useFlowChoices: () => ({ data: [] }),
  useRule: (id: string | null) => {
    state.ruleIds.push(id);
    return { data: undefined, isPending: id !== null, isError: false, error: null };
  },
}));

import { RuleFormScreen } from './rule-form-screen';

const addon = (offer: FeatureAddon['offer']): FeatureAddon[] => [
  {
    feature: 'inbox_routing',
    addonSlug: 'smart_routing',
    addonName: 'Smart routing',
    offer,
    amount: '199.00',
    currency: 'INR',
    billingUnit: 'months',
    billingDuration: 1,
  },
];

function page(
  features: string[] | null,
  featureAddons: FeatureAddon[] | null,
  id?: string,
): string {
  state.ruleIds = [];
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
      <PlanFeaturesProvider features={features} featureAddons={featureAddons}>
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider dismissLabel="Dismiss">
            <RuleFormScreen id={id} />
          </ToastProvider>
        </QueryClientProvider>
      </PlanFeaturesProvider>
    </NextIntlClientProvider>,
  );
}

describe('the rule form and the Smart routing add-on', () => {
  it('without inbox_routing shows the add-on card instead of the form (and no paywall sheet), and loads no rule', () => {
    const out = page([], addon('buy'), 'r1');
    expect(out).toContain('data-testid="feature-addon-lock"');
    expect(out).toContain('Add Smart routing for');
    expect(out).not.toContain('plan-paywall');
    expect(out).not.toContain('Create rule');
    expect(out).toContain('href="/auto-assignment"');
    expect(state.ruleIds).toEqual([null]);
  });

  it('when the plan does not offer the add-on: a plain "not available on your plan" note, no upsell', () => {
    const out = page([], addon('hidden'));
    expect(out).toContain('data-testid="rules-unavailable"');
    expect(out).toContain('Rules are not available on your plan');
    expect(out).not.toContain('feature-addon-lock');
    expect(out).not.toContain('/account/plans');
  });

  it('with inbox_routing shows the form', () => {
    const out = page(['inbox_routing'], addon('owned'));
    expect(out).toContain('Create rule');
    expect(out).not.toContain('feature-addon-lock');
    expect(out).not.toContain('rules-unavailable');
  });
});
