import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { FeatureAddon, HandoffSettings } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';
import { PlanFeaturesProvider } from '@/lib/plan-features';
import { ApiError } from '@/lib/api/errors';

const settings: HandoffSettings = {
  autoAssign: true,
  claimSetsOwner: false,
  ownerMode: 'independent',
  continuityDays: null,
  promptOwnerOnReassign: false,
  notifyQueue: true,
  away: {
    returnUnanswered: false,
    autoOfflineMinutes: null,
    unansweredReturnMinutes: null,
    idleCloseMinutes: null,
  },
  queueTimers: {
    remindMinutes: null,
    overflowMinutes: null,
    overflowTeamId: null,
    unclaimedMinutes: null,
    unclaimedAction: 'keep',
    unclaimedMessage: '',
  },
  available: {
    queueTimers: true,
    away: true,
    autoAssign: true,
    ownerFirst: true,
    keepInSync: true,
    continuityWindow: true,
    promptOwnerOnReassign: true,
  },
};

const state = vi.hoisted(() => ({
  rulesEnabled: [] as boolean[],
  rulesError: null as unknown,
}));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => true,
}));
vi.mock('@/features/persona-vocabulary', () => ({
  useVocab: () => ({ pluralLower: 'contacts' }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('./business-hours-dialog', () => ({ BusinessHoursDialog: () => null }));
vi.mock('./try-it-panel', () => ({ TryItPanel: () => <div data-testid="try-it" /> }));
vi.mock('../api/routing', () => ({
  KEYS: { settings: ['s'] },
  routingApi: {},
  refresh: vi.fn(),
  updateRuleFresh: vi.fn(),
  useRules: (_q: string, enabled: boolean) => {
    state.rulesEnabled.push(enabled);
    return {
      data: state.rulesError
        ? undefined
        : { pages: [{ data: [], page: { nextCursor: null }, limit: null, total: 0 }] },
      error: state.rulesError,
      isPending: false,
      isError: state.rulesError !== null,
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: vi.fn(),
      fetchNextPage: vi.fn(),
    };
  },
  useAssignees: () => ({ data: { users: [], teams: [] } }),
  useHandoffSettings: () => ({
    data: settings,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpdateHandoffSettings: () => ({ mutate: vi.fn(), isPending: false }),
  useRoutingSettings: () => ({ data: { keepContactAgent: false }, isPending: false }),
}));

import { AutoAssignmentScreen } from './auto-assignment-screen';

const smartRouting = (offer: FeatureAddon['offer']): FeatureAddon[] =>
  ['inbox_routing', 'inbox_assignment_sticky'].map((feature) => ({
    feature,
    addonSlug: 'smart_routing',
    addonName: 'Smart routing',
    offer,
    amount: '199.00',
    currency: 'INR',
    billingUnit: 'months',
    billingDuration: 1,
  }));

function page(features: string[] | null, featureAddons: FeatureAddon[] | null = null) {
  state.rulesEnabled = [];
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
      <PlanFeaturesProvider features={features} featureAddons={featureAddons}>
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider dismissLabel="Dismiss">
            <AutoAssignmentScreen />
          </ToastProvider>
        </QueryClientProvider>
      </PlanFeaturesProvider>
    </NextIntlClientProvider>,
  );
}

const SMART = [
  'data-testid="switch-auto"',
  'data-testid="switch-sticky"',
  'data-testid="switch-owner"',
  'data-testid="rules-layer"',
  'data-testid="try-it"',
  'data-testid="where-applies"',
  'data-testid="wq-remind"',
];

describe('/auto-assignment and the Smart routing add-on', () => {
  it('without inbox_routing: base controls and one add-on card, none of the Smart routing parts, no rules request', () => {
    const out = page(['inbox_sla'], smartRouting('buy'));
    for (const part of SMART) expect(out, part).not.toContain(part);
    expect(out).toContain('data-testid="switch-claim"');
    expect(out).toContain('Assign Agent as Contact Owner');
    expect(out).toContain('data-testid="advanced-queue-alert"');
    expect(out).toContain('data-testid="waiting-queue-note"');
    // business hours stay with SLA
    expect(out).toContain('Business hours');
    expect(out.match(/data-testid="feature-addon-lock"/g)).toHaveLength(1);
    expect(out).toContain('Add Smart routing for');
    expect(state.rulesEnabled.every((e) => !e)).toBe(true);
  });

  it('without inbox_routing and no SLA: no business hours button', () => {
    expect(page([], smartRouting('buy'))).not.toContain('Business hours');
  });

  it('when the plan does not offer the add-on (hidden): base controls only, no card', () => {
    const out = page([], smartRouting('hidden'));
    for (const part of SMART) expect(out, part).not.toContain(part);
    expect(out).not.toContain('feature-addon-lock');
    expect(out).toContain('data-testid="switch-claim"');
    expect(out).toContain('data-testid="waiting-queue-note"');
  });

  it('with the features: every part is drawn and there is no card', () => {
    const out = page(['inbox_routing', 'inbox_assignment_sticky'], smartRouting('owned'));
    for (const part of SMART) expect(out, part).toContain(part);
    expect(out).toContain('data-testid="switch-claim"');
    expect(out).not.toContain('feature-addon-lock');
    expect(state.rulesEnabled.every((e) => e)).toBe(true);
  });

  it('points to Team members for who is available and the Concurrent chats limit', () => {
    const out = page(['inbox_routing', 'inbox_assignment_sticky'], smartRouting('owned'));
    expect(out).toContain('data-testid="agents-note"');
    expect(out).toContain('Concurrent chats');
    expect(out).toContain('href="/settings/team"');
  });

  it('unknown entitlements hide nothing', () => {
    const out = page(null);
    for (const part of SMART) expect(out, part).toContain(part);
  });

  it('a rules list refused by the plan hides the Smart routing parts and shows the card', () => {
    state.rulesError = new ApiError(422, 'PLAN_FEATURE_LOCKED', 'Locked');
    const out = page(null);
    state.rulesError = null;
    expect(out).not.toContain('data-testid="rules-layer"');
    expect(out).not.toContain('data-testid="switch-auto"');
    expect(out).toContain('data-testid="feature-addon-lock"');
  });
});
