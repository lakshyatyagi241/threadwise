import { describe, expect, it } from 'vitest';
import type { OverviewStatsResponse } from '@crm/contracts';
import { humanShortNumber, deviceHealth, weekDelta } from '@crm/contracts';
import { CATALOGUE } from './more-catalogue';
import { activityBadge, activityLabel, allToolCards, filterCards } from './more-model';
import { footValues } from './more-stats';

const ctx = { plan: 'Growth', balance: '$4.00', next: 'in 2 hours' };
const base = (over: Partial<OverviewStatsResponse> = {}): OverviewStatsResponse =>
  ({
    activeRules: 4,
    activeRulesNew: 1,
    scheduledQueued: 3,
    nextScheduledAt: null,
    devicesActive: 1,
    devicesTotal: 2,
    unreadNotifications: 5,
    contacts: 12,
    groups: 2,
    tags: 7,
    attributes: 9,
    broadcastsQueued: 1,
    deliveredPct: 87,
    autoReplyRules: 2,
    autoReplyMatchPct: null,
    webhookEndpoints: 3,
    supportTotal: 4,
    supportOpen: 1,
    messageHistory: 12_500,
    outbound7d: 1234,
    activity24h: 8,
    seats: 1,
    messagesThisMonth: 10,
    widgetsBuilt: 2,
    widgetsLive: 1,
    bookingTypes: 0,
    formsDrafted: 3,
    formsLive: 1,
    assistantsConfigured: 1,
    assistantsLive: 1,
    agentsConfigured: 2,
    agentsLive: 1,
    calls24h: 2,
    callMinutes24h: 7,
    chatLinks: 3,
    chatLinkClicks: 2500,
    aiTokensThisMonth: 1_500_000,
    flowFailedRuns: 0,
    integrationsConnected: 1,
    affiliateReferrals: 0,
    recentActivity: [],
    ...over,
  }) as OverviewStatsResponse;

describe('humanShortNumber (WaDesk rule 2)', () => {
  it('follows the four bands', () => {
    expect(humanShortNumber(999)).toBe('999');
    expect(humanShortNumber(1234)).toBe('1.2k');
    expect(humanShortNumber(1000)).toBe('1k');
    expect(humanShortNumber(12_500)).toBe('13k');
    expect(humanShortNumber(1_500_000)).toBe('1.5M');
    expect(humanShortNumber(12_000_000)).toBe('12M');
  });
});

describe('device health and the week caption', () => {
  it('reads healthy, partial, offline and no devices', () => {
    expect(deviceHealth(2, 2)).toBe('healthy');
    expect(deviceHealth(1, 2)).toBe('partial');
    expect(deviceHealth(0, 2)).toBe('offline');
    expect(deviceHealth(0, 0)).toBe('none');
  });
  it('shows no change as zero', () => {
    expect(weekDelta(null)).toBe(0);
    expect(weekDelta(3)).toBe(3);
  });
});

describe('footValues (WD-ASHELL-020 card footers)', () => {
  it('has no footer while the figures load or when one failed', () => {
    expect(footValues('contacts', undefined, ctx)).toBeNull();
    expect(footValues('contacts', base({ tags: null }), ctx)).toBeNull();
  });
  it('plain-caption cards need no figure', () => {
    expect(footValues('sms', undefined, ctx)).toEqual({});
    expect(footValues('warmer', undefined, ctx)).toEqual({});
  });
  it('builds the figures', () => {
    expect(footValues('contacts', base(), ctx)).toEqual({ people: 12, groups: 2, tags: 7 });
    expect(footValues('analytics', base(), ctx)).toEqual({ count: '1.2k' });
    expect(footValues('message-history', base(), ctx)).toEqual({ count: '13k' });
    expect(footValues('broadcasts', base(), ctx)).toEqual({ queued: 1, pct: 87 });
    expect(footValues('auto-reply', base(), ctx)).toEqual({ count: 2, pct: 'none' });
    expect(footValues('scheduled', base(), ctx)).toEqual({ queued: 3, next: 'in 2 hours' });
    expect(footValues('integrations', base(), ctx)).toEqual({ connected: 1, available: 3 });
    expect(footValues('account', base(), ctx)).toEqual({ plan: 'Growth', balance: '$4.00' });
    expect(footValues('channels', base(), ctx)).toEqual({ active: 1, total: 2 });
  });
});

describe('recent activity labels (WD-ASHELL-020 rule 1)', () => {
  it('title-cases "<Category> <rest>"', () => {
    expect(activityLabel('contacts', 'insert')).toBe('Contacts insert');
    expect(activityLabel('deal_pipelines', 'update')).toBe('Deal pipelines update');
  });
  it('gives known categories their badge and the rest dots', () => {
    expect(activityBadge('webhooks').code).toBe('WH');
    expect(activityBadge('contacts').code).toBe('•••');
  });
});

describe('allToolCards', () => {
  const item = (id: string, href: string, locked = false, comingSoon = false, group = 'overview') =>
    ({ id, group, labelKey: `nav.${id}`, href, locked, comingSoon }) as never;
  const nav = [
    item('analytics', '/analytics'),
    item('contacts', '/contacts'),
    item('scheduled', '/scheduled', true),
    item('support', '/support'),
    item('soon', '/webhooks', false, true),
    item('extra', '/extra-tool', false, false, 'apps'),
  ];

  it('lists curated cards in WaDesk order, then the other reachable screens; a missing or coming-soon screen has no card', () => {
    const cards = allToolCards(CATALOGUE, nav, [], new Set());
    expect(cards.map((c) => c.id)).toEqual([
      'cat:analytics',
      'cat:contacts',
      'cat:scheduled',
      'cat:support',
      'nav:extra',
    ]);
  });

  it('takes the crown from the screen and skips what the bar already holds', () => {
    const cards = allToolCards(CATALOGUE, nav, [], new Set(['/contacts']));
    expect(cards.find((c) => c.id === 'cat:scheduled')?.locked).toBe(true);
    expect(cards.some((c) => c.id === 'cat:contacts')).toBe(false);
  });

  it('files each curated card under WaDesk’s tab', () => {
    const cards = allToolCards(CATALOGUE, nav, [], new Set());
    expect(filterCards(cards, 'data').map((c) => c.id)).toEqual(['cat:analytics', 'cat:contacts']);
    expect(filterCards(cards, 'automation').map((c) => c.id)).toEqual(['cat:scheduled']);
    expect(filterCards(cards, 'help').map((c) => c.id)).toEqual(['cat:support']);
  });
});
