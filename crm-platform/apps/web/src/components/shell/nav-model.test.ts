import { describe, expect, it } from 'vitest';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { NAV } from '@/features/_registry/nav.generated';
import { PLANNED_NAV } from '@/features/_registry/planned';
import { CAPABILITIES_UNKNOWN, resolveNav } from '@/features/_registry/resolve';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import { SETTINGS } from '@/features/_registry/settings.generated';
import { PLANNED_SETTINGS } from '@/features/_registry/settings-planned';
import { resolveSettings } from '@/features/_registry/settings-resolve';
import {
  activeItemId,
  activeNavId,
  helpItems,
  isFullWidthScreen,
  matchesHref,
  menuItems,
  railSections,
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
      'help',
      'settings',
    ]);
  });

  it('orders Platform, Inbox & Chat and CRM as specified', () => {
    expect(ids('overview')).toEqual(['dashboard', 'analytics', 'notifications']);
    expect(ids('inbox')).toEqual(['inbox', 'quick-chat', 'call-logs', 'team-chat']);
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

describe('full-width screens', () => {
  const resolved = resolveNav(NAV, CAPABILITIES_UNKNOWN, { planned: PLANNED_NAV });
  const tiles = resolveSettings(SETTINGS, CAPABILITIES_UNKNOWN, { planned: PLANNED_SETTINGS });

  it('slims the menu on the inbox and team chat, and nowhere else', () => {
    expect(isFullWidthScreen(resolved, tiles, '/inbox')).toBe(true);
    expect(isFullWidthScreen(resolved, tiles, '/team-chat')).toBe(true);
    expect(isFullWidthScreen(resolved, tiles, '/contacts')).toBe(false);
    expect(isFullWidthScreen(resolved, tiles, '/deals')).toBe(false);
    expect(isFullWidthScreen(resolved, tiles, '/settings')).toBe(false);
  });
});

describe('the menu after the Settings move', () => {
  const resolved = resolveNav(NAV, CAPABILITIES_UNKNOWN, { planned: PLANNED_NAV });
  const menuIds = new Set(resolved.map((i) => i.id));
  const tiles = resolveSettings(SETTINGS, CAPABILITIES_UNKNOWN, { planned: PLANNED_SETTINGS });

  it('has only the Settings entry in the settings group', () => {
    expect(resolved.filter((i) => i.group === 'settings').map((i) => i.id)).toEqual(['settings']);
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
      'bsp-billing-mode',
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
