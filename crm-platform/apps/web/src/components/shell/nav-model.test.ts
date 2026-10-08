import { describe, expect, it } from 'vitest';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { NAV } from '@/features/_registry/nav.generated';
import { MENU_PLANNED_NAV, PLANNED_NAV } from '@/features/_registry/planned';
import { CAPABILITIES_UNKNOWN, resolveNav } from '@/features/_registry/resolve';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import { SETTINGS } from '@/features/_registry/settings.generated';
import { PLANNED_SETTINGS } from '@/features/_registry/settings-planned';
import { resolveSettings } from '@/features/_registry/settings-resolve';
import {
  activeItemId,
  activeNavId,
  helpItems,
  matchesHref,
  menuItems,
  railSections,
  routeGateFor,
  toSections,
} from './nav-model';

const item = (
  id: string,
  group: ResolvedNavItem['group'],
  href: string,
  over: Partial<ResolvedNavItem> = {},
): ResolvedNavItem => ({
  id,
  group,
  href,
  labelKey: id,
  locked: false,
  comingSoon: false,
  ...over,
});

const items = [
  item('dashboard', 'overview', '/dashboard'),
  item('analytics', 'overview', '/analytics', { comingSoon: true }),
  item('contacts', 'audience', '/contacts'),
  item('groups', 'audience', '/contact-groups'),
  item('flows', 'automation', '/flows', { comingSoon: true }),
  item('account', 'settings', '/account'),
];

describe('toSections', () => {
  it('groups consecutive items and keeps their order', () => {
    expect(toSections(items).map((s) => [s.group, s.items.map((i) => i.id)])).toEqual([
      ['overview', ['dashboard', 'analytics']],
      ['audience', ['contacts', 'groups']],
      ['automation', ['flows']],
      ['settings', ['account']],
    ]);
  });
  it('is empty for no items', () => expect(toSections([])).toEqual([]));
});

describe('railSections', () => {
  it('keeps only real screens and drops groups left empty', () => {
    expect(railSections(toSections(items)).map((s) => [s.group, s.items.map((i) => i.id)])).toEqual(
      [
        ['overview', ['dashboard']],
        ['audience', ['contacts', 'groups']],
        ['settings', ['account']],
      ],
    );
  });
});

describe('matchesHref', () => {
  it('matches the page and its children only at a path boundary', () => {
    expect(matchesHref('/contacts', '/contacts')).toBe(true);
    expect(matchesHref('/contacts/42', '/contacts')).toBe(true);
    expect(matchesHref('/contacts-archive', '/contacts')).toBe(false);
    expect(matchesHref('/contact-groups', '/contacts')).toBe(false);
  });
});

describe('activeItemId', () => {
  it('picks the longest matching real screen', () => {
    const nested = [...items, item('account-security', 'settings', '/account/security')];
    expect(activeItemId(nested, '/account/security')).toBe('account-security');
    expect(activeItemId(nested, '/account/profile')).toBe('account');
  });
  it('never marks a coming-soon entry active', () => {
    expect(activeItemId(items, '/flows')).toBeUndefined();
  });
  it('is undefined off the menu', () => expect(activeItemId(items, '/elsewhere')).toBeUndefined());
});

describe('the real menu', () => {
  const sections = toSections(resolveNav(NAV, CAPABILITIES_UNKNOWN, { planned: PLANNED_NAV }));
  const ids = (group: string) => sections.find((s) => s.group === group)?.items.map((i) => i.id);

  it('lists the groups in menu order', () => {
    expect(sections.map((s) => s.group)).toEqual([
      'overview',
      'inbox',
      'audience',
      'sales',
      'campaigns',
      'automation',
      'store',
      'apps',
      'help',
      'settings',
    ]);
  });

  it('orders Platform, Inbox & Chat and CRM as specified', () => {
    expect(ids('overview')).toEqual(['dashboard', 'analytics', 'reports', 'notifications']);
    expect(ids('inbox')).toEqual(['inbox', 'quick-chat', 'call-logs', 'team-chat', 'devices']);
    expect(ids('audience')).toEqual([
      'contacts',
      'contact-groups',
      'segments',
      'lead-finder',
      'deals',
      'tasks',
      'companies',
      'email-templates',
    ]);
  });

  it('drops a group whose items are all gated away', () => {
    const gated = resolveNav(
      [{ id: 'x', group: 'store', labelKey: 'x', href: '/x', gates: { permission: 'nope' } }],
      { ...CAPABILITIES_UNKNOWN, permissions: new Set() },
    );
    expect(toSections(gated)).toEqual([]);
  });
});

describe('menuItems and inMenu: false', () => {
  const tile = (href: string, over: Partial<ResolvedSettingsTile> = {}): ResolvedSettingsTile =>
    ({
      id: 't',
      section: 'integrations',
      labelKey: 't',
      href,
      icon: 'x',
      locked: false,
      comingSoon: false,
      ...over,
    }) as ResolvedSettingsTile;
  const store = item('store', 'store', '/store');
  const orders = item('store-orders', 'store', '/store/orders', { inMenu: false });
  const shopify = item('shopify', 'store', '/shopify', { inMenu: false });
  const ids = (list: ResolvedNavItem[], tiles: ResolvedSettingsTile[] = []) =>
    menuItems(list, tiles).map((i) => i.id);

  it('drops a screen its area entry already covers', () => {
    expect(ids([store, orders])).toEqual(['store']);
  });

  it('keeps it for a role that cannot see the area entry (nobody loses a screen)', () => {
    expect(ids([orders])).toEqual(['store-orders']);
  });

  it('drops a screen a Settings tile points at, and keeps it while that tile is only planned', () => {
    expect(ids([store, shopify], [tile('/shopify')])).toEqual(['store']);
    expect(ids([store, shopify], [tile('/shopify', { comingSoon: true })])).toEqual([
      'store',
      'shopify',
    ]);
    expect(ids([store, shopify])).toEqual(['store', 'shopify']);
  });

  it('only matches on a path boundary and ignores entries without the flag', () => {
    const lookalike = item('lookalike', 'store', '/store-archive', { inMenu: false });
    expect(ids([store, lookalike])).toEqual(['store', 'lookalike']);
    expect(ids([store, item('plain', 'store', '/store/plain')])).toEqual(['store', 'plain']);
  });

  it('lights the covering entry for a screen it does not draw', () => {
    const drawn = menuItems([store, orders]);
    expect(activeItemId(drawn, '/store/orders/42')).toBe('store');
  });
});

describe('the sidebar as the workspace layout builds it', () => {
  const sidebar = resolveNav(NAV, CAPABILITIES_UNKNOWN, { planned: MENU_PLANNED_NAV });

  it('offers no disabled "Soon" entries: only screens that work are listed', () => {
    expect(sidebar.filter((i) => i.comingSoon).map((i) => i.id)).toEqual([]);
    // Not-yet-built screens stay on record in PLANNED_NAV, and a real screen still takes over its planned id.
    expect(PLANNED_NAV.length).toBeGreaterThan(0);
  });

  it('still lists every screen a domain has built', () => {
    const real = new Set(NAV.filter((n) => !n.href.startsWith('/account/')).map((n) => n.id));
    const listed = new Set(sidebar.map((i) => i.id));
    expect([...real].filter((id) => !listed.has(id))).toEqual([]);
  });
});

describe('the menu after the Settings move', () => {
  const resolved = resolveNav(NAV, CAPABILITIES_UNKNOWN, { planned: PLANNED_NAV });
  const menuIds = new Set(resolved.map((i) => i.id));
  const tiles = resolveSettings(SETTINGS, CAPABILITIES_UNKNOWN, { planned: PLANNED_SETTINGS });

  it('pins only Help and Settings in the settings group, Help directly above Settings', () => {
    expect(resolved.filter((i) => i.group === 'settings').map((i) => i.id)).toEqual([
      'help-center',
      'settings',
    ]);
  });

  it('no longer lists the configuration screens', () => {
    for (const id of [
      'contact-stages',
      'contact-properties',
      'attributes',
      'tax-rates',
      'business-profile',
      'addons-workspace',
      'i18n-translation',
      'ai-keys',
      'billing-orders',
      'account',
      'chat-widget',
      'team-members',
      'auto-reply',
      'channels',
      'telegram',
      'sms',
      'integrations',
      'rest-api',
      'webhooks',
      'activity-log',
    ]) {
      expect(menuIds.has(id), id).toBe(false);
    }
  });

  it('keeps the daily-work screens', () => {
    for (const id of [
      'dashboard',
      'analytics',
      'team-chat',
      'contacts',
      'contact-groups',
      'segments',
      'deals',
      'tasks',
      'appointments',
      'proposals',
      'estimates',
      'invoices',
      'recurring-invoices',
      'credit-notes',
      'sales-orders',
      'payments',
      'broadcasts',
    ]) {
      expect(menuIds.has(id), id).toBe(true);
    }
  });

  it('keeps Help links out of the rail and in the user menu', () => {
    expect(menuItems(resolved).some((i) => i.group === 'help')).toBe(false);
    expect(helpItems(resolved).map((i) => i.id)).toEqual(['support', 'guidebook']);
  });

  it('highlights Settings on a Settings page and on a screen a tile points at', () => {
    expect(activeNavId(resolved, tiles, '/settings')).toBe('settings');
    expect(activeNavId(resolved, tiles, '/settings/business')).toBe('settings');
    expect(activeNavId(resolved, tiles, '/tax-rates')).toBe('settings');
    expect(activeNavId(resolved, tiles, '/contact-stages')).toBe('settings');
    expect(activeNavId(resolved, tiles, '/account/security')).toBe('settings');
  });

  it('keeps a daily screen active, and a nested settings tile wins over its parent menu entry', () => {
    expect(activeNavId(resolved, tiles, '/contacts')).toBe('contacts');
    expect(activeNavId(resolved, tiles, '/appointments')).toBe('appointments');
    expect(activeNavId(resolved, tiles, '/appointments/types')).toBe('settings');
    expect(activeNavId(resolved, tiles, '/deals')).toBe('deals');
    expect(activeNavId(resolved, tiles, '/deals/settings')).toBe('settings');
  });

  it('prefers the menu entry on a tie', () => {
    const tile = {
      id: 't',
      section: 'data',
      labelKey: 't',
      href: '/tasks',
      icon: 'x',
      locked: false,
      comingSoon: false,
    } as ResolvedSettingsTile;
    expect(activeNavId(resolved, [tile], '/tasks')).toBe('tasks');
  });
});

describe('routeGateFor', () => {
  const gates = [
    { href: '/appointments', feature: 'appointment_booking' },
    { href: '/appointments/reports', feature: 'appointment_reports' },
    { href: '/contacts', feature: 'contacts_app' },
  ];

  it('finds the gate that covers the page and its children', () => {
    expect(routeGateFor(gates, '/appointments')?.feature).toBe('appointment_booking');
    expect(routeGateFor(gates, '/appointments/types/new')?.feature).toBe('appointment_booking');
  });

  it('prefers the longest address, so a nested gate wins over its parent', () => {
    expect(routeGateFor(gates, '/appointments/reports/2026')?.feature).toBe('appointment_reports');
  });

  it('matches on a path boundary only, and returns null off every gate', () => {
    expect(routeGateFor(gates, '/appointments-archive')).toBeNull();
    expect(routeGateFor(gates, '/dashboard')).toBeNull();
    expect(routeGateFor([], '/appointments')).toBeNull();
  });
});
