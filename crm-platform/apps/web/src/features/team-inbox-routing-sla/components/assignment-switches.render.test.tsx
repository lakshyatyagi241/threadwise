import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { FeatureAddon, HandoffSettings, RoutingTestResponse } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';
import { PlanFeaturesProvider } from '@/lib/plan-features';
import { U1, rule } from '../lib/fixtures';
import { AssignmentSwitches } from './assignment-switches';
import { EveryoneElseRow } from './everyone-else-row';
import { TryItResult } from './try-it-panel';

const base: HandoffSettings = {
  autoAssign: true,
  claimSetsOwner: false,
  ownerMode: 'independent',
  continuityDays: null,
  promptOwnerOnReassign: false,
  notifyQueue: true,
  away: { returnUnanswered: false, autoOfflineMinutes: null },
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
let data: HandoffSettings = base;
let keep = false;
let can = true;

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (k: string) => (k === 'inbox.routing.manage' ? can : true),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../api/routing', () => ({
  KEYS: { settings: ['s'] },
  routingApi: {},
  refresh: vi.fn(),
  updateRuleFresh: vi.fn(),
  useHandoffSettings: () => ({ data, isPending: false, isError: false, refetch: vi.fn() }),
  useUpdateHandoffSettings: () => ({ mutate: vi.fn(), isPending: false }),
  useRoutingSettings: () => ({ data: { keepContactAgent: keep }, isPending: false }),
}));

/** The plan features and add-on offers the layout hands down; null = unknown (nothing hidden). */
let plan: { features: string[] | null; featureAddons: FeatureAddon[] | null } = {
  features: null,
  featureAddons: null,
};
const wrap = (el: React.ReactElement, locale = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)} timeZone="UTC">
      <PlanFeaturesProvider features={plan.features} featureAddons={plan.featureAddons}>
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
        </QueryClientProvider>
      </PlanFeaturesProvider>
    </NextIntlClientProvider>,
  );
const switches = () => wrap(<AssignmentSwitches onAutoEnabled={async () => undefined} />);
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
const SMART_SWITCHES = /data-testid="switch-(auto|sticky|owner)"/;
const SMART_ADVANCED = /data-testid="advanced-(sync|window|prompt)"/;

describe('the four switches', () => {
  it('shows the four switches in the owner wording, in the order they run, with Advanced under them', () => {
    data = base;
    const out = switches();
    for (const title of [
      'Auto Assignment',
      'Sticky Agent',
      'Assign Chat to Contact Owner',
      'Assign Agent as Contact Owner',
    ]) {
      expect(out).toContain(title);
    }
    const at = (id: string) => out.indexOf(`data-testid="switch-${id}"`);
    expect(at('auto')).toBeGreaterThan(-1);
    expect(at('auto')).toBeLessThan(at('sticky'));
    expect(at('sticky')).toBeLessThan(at('owner'));
    expect(at('owner')).toBeLessThan(at('claim'));
    // the order text, and the chat-limit hint linking to where the limit is set
    expect(out).toContain('Contact Owner and Sticky Agent first, then your rules');
    expect(out).toContain('href="/team-members"');
    // the extras are in Advanced, not mixed in with the four
    expect(out).toContain('data-testid="advanced"');
    expect(out.indexOf('data-testid="advanced"')).toBeGreaterThan(out.indexOf('switch-claim'));
    expect(out).toContain('Keep open chats with the owner');
  });

  it('says which wins when the owner switch and the sticky switch are both on', () => {
    data = { ...base, ownerMode: 'owner_first' };
    keep = true;
    const out = switches();
    keep = false;
    expect(out).toContain('the contact owner still wins');
  });

  it('without Smart routing draws none of its switches, keeps the base controls and shows one add-on card', () => {
    data = base;
    plan = { features: ['inbox_sla'], featureAddons: smartRouting('buy') };
    const out = switches();
    plan = { features: null, featureAddons: null };
    expect(out).not.toMatch(SMART_SWITCHES);
    expect(out).not.toMatch(SMART_ADVANCED);
    expect(out).not.toContain('data-testid="switch-order"');
    // base: claim sets the contact owner, the queue alert
    expect(out).toContain('data-testid="switch-claim"');
    expect(out).toContain('Assign Agent as Contact Owner');
    expect(out).toContain('data-testid="advanced-queue-alert"');
    expect(out.match(/data-testid="feature-addon-lock"/g)).toHaveLength(1);
    expect(out).toMatch(/Add Smart routing for ₹199\.00 \/ month/);
    expect(out).toContain('href="/account/plans"');
    expect(out).toContain('new chats wait in the queue until someone claims them');
  });

  it('when the plan does not offer the add-on (hidden) shows the base controls and no card at all', () => {
    data = base;
    plan = { features: [], featureAddons: smartRouting('hidden') };
    const out = switches();
    plan = { features: null, featureAddons: null };
    expect(out).not.toMatch(SMART_SWITCHES);
    expect(out).not.toContain('feature-addon-lock');
    expect(out).toContain('data-testid="switch-claim"');
    expect(out).toContain('data-testid="advanced-queue-alert"');
  });

  it("follows the server's answer too: a plan the settings call reports without routing hides the switches", () => {
    data = {
      ...base,
      available: {
        queueTimers: false,
        away: false,
        autoAssign: false,
        ownerFirst: false,
        keepInSync: false,
        continuityWindow: false,
        promptOwnerOnReassign: false,
      },
    };
    const out = switches();
    data = base;
    expect(out).not.toMatch(SMART_SWITCHES);
    expect(out).toContain('data-testid="feature-addon-lock"');
    const claim = out.slice(
      out.indexOf('data-testid="switch-claim"'),
      out.indexOf('data-testid="advanced"'),
    );
    expect(claim).toContain('role="switch"');
    expect(claim).not.toContain('disabled=""');
  });

  it('routing without the sticky feature keeps the master switch and locks only the sticky parts', () => {
    data = base;
    plan = { features: ['inbox_routing'], featureAddons: smartRouting('included') };
    const out = switches();
    plan = { features: null, featureAddons: null };
    expect(out).toContain('data-testid="switch-auto"');
    expect(out).not.toContain('data-testid="switch-sticky"');
    expect(out).not.toContain('data-testid="switch-owner"');
    expect(out).not.toMatch(SMART_ADVANCED);
    expect(out).toContain('data-offer="off"');
  });

  it('with Smart routing shows every switch and extra, and no card', () => {
    data = base;
    plan = {
      features: ['inbox_routing', 'inbox_assignment_sticky'],
      featureAddons: smartRouting('owned'),
    };
    const out = switches();
    plan = { features: null, featureAddons: null };
    for (const id of ['auto', 'sticky', 'owner', 'claim'])
      expect(out).toContain(`data-testid="switch-${id}"`);
    for (const id of ['sync', 'window', 'prompt', 'queue-alert'])
      expect(out).toContain(`data-testid="advanced-${id}"`);
    expect(out).not.toContain('feature-addon-lock');
    expect(out).not.toMatch(/upgrade/i);
  });

  it('without the manage right shows the read-only notice and disables the switches', () => {
    data = base;
    can = false;
    const out = switches();
    can = true;
    expect(out).toContain('You can see these switches but not change them.');
    expect(out).toContain('disabled=""');
  });

  it('when Auto Assignment is off it says what that means and dims the steps that need it', () => {
    data = { ...base, autoAssign: false };
    const out = switches();
    expect(out).toContain('nothing is assigned automatically');
    expect(out).toContain('Used only while Auto Assignment is on.');
  });
});

describe('Everyone else', () => {
  const names = new Map([[U1, 'Asha Rao']]);
  const row = (r?: ReturnType<typeof rule>) =>
    wrap(<EveryoneElseRow rule={r} names={names} canManage />);

  it('with no row it says chats wait in the queue and offers the three choices', () => {
    const out = row(undefined);
    expect(out).toContain('Not set up yet');
    expect(out).toContain('Distribute evenly among all agents');
    expect(out).toContain('Choose agents or teams');
    expect(out).toContain('Leave in the waiting queue');
    expect(out).toMatch(/data-testid="everyone-queue"[^>]*checked/);
  });

  it('shows the row that distributes evenly as selected, with the way of sharing', () => {
    const out = row(
      rule({
        isFallback: true,
        appliesToAll: true,
        assign: { strategy: 'least_busy', userIds: [], teamIds: [], everyone: true },
      }),
    );
    expect(out).toMatch(/data-testid="everyone-evenly"[^>]*checked/);
    expect(out).toContain('Least busy');
  });

  it('names the agents when it points at some, and a switched-off row is the queue', () => {
    const listed = row(
      rule({
        isFallback: true,
        assign: { strategy: 'specific', userIds: [U1], teamIds: [], everyone: false },
      }),
    );
    expect(listed).toContain('Now: Asha Rao.');
    const off = row(rule({ isFallback: true, isActive: false }));
    expect(off).toMatch(/data-testid="everyone-queue"[^>]*checked/);
  });
});

describe('the Try it result', () => {
  const res = (over: Partial<RoutingTestResponse> = {}): RoutingTestResponse => ({
    outcome: 'rule',
    ruleId: U1,
    ruleName: 'Refunds',
    assigneeUserId: U1,
    assigneeTeamId: null,
    how: 'round_robin',
    steps: [
      {
        kind: 'sticky',
        result: 'passed',
        ruleId: null,
        ruleName: null,
        why: 'sticky_off',
        conditions: [],
      },
      {
        kind: 'rule',
        result: 'passed',
        ruleId: U1,
        ruleName: 'Customers',
        why: 'conditions_failed',
        conditions: [{ part: 'contact', matched: false, why: 'no_saved_value' }],
      },
      {
        kind: 'rule',
        result: 'decided',
        ruleId: U1,
        ruleName: 'Refunds',
        why: 'agent_picked',
        conditions: [],
      },
    ],
    trace: [{ step: 'candidate', who: U1, result: 'skipped', why: 'on_leave' }],
    contact: { found: true, kind: 'new', stage: 'new', hasOwner: false, tagCount: 0 },
    outsideHours: false,
    ...over,
  });
  const show = (r: RoutingTestResponse) =>
    wrap(<TryItResult res={r} names={new Map([[U1, 'Asha Rao']])} />);

  it('names the deciding step and the person, goes through every step and says why a detail did not match', () => {
    const out = show(res());
    expect(out).toContain('The rule “Refunds” decides: Asha Rao.');
    expect(out).toContain('Rule “Customers”');
    expect(out).toContain('Did not match.');
    expect(out).toContain('this contact does not have that saved, so it did not match');
    expect(out).toContain('This contact is new. Stage: new. It has no owner. No tags saved.');
    expect(out).toContain('Left out');
    expect(out).toContain('Asha Rao: on leave');
  });

  it('answers each of the other outcomes in words', () => {
    expect(show(res({ outcome: 'queue', ruleName: null, assigneeUserId: null }))).toContain(
      'Nobody is found: the chat waits in the queue.',
    );
    expect(show(res({ outcome: 'off', ruleName: null, assigneeUserId: null }))).toContain(
      'Auto Assignment is switched off',
    );
    expect(show(res({ outcome: 'everyone_else', ruleName: null }))).toContain(
      'Everyone else decides: Asha Rao.',
    );
    expect(show(res({ outcome: 'sticky', ruleName: null }))).toContain(
      'Keep with their agent decides: Asha Rao.',
    );
  });
});
