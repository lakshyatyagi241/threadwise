import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NOTIFICATION_CATEGORY_KEYS,
  NOTIFICATION_EVENT_KEYS,
  type NotificationPrefsResponse,
} from '@crm/contracts';
import {
  SETTINGS_TABS,
  TAB_GROUPS,
  TAB_LINKS,
  canSubmitDelete,
  filterTimeZones,
  parseTab,
  timeZoneList,
  toMatrix,
  toRequest,
  toggleFlag,
  DEFAULT_BRAND,
  colourChanged,
  normaliseColour,
} from './logic';

const prefs = (): NotificationPrefsResponse => ({
  events: NOTIFICATION_EVENT_KEYS.map((key) => ({
    key,
    inapp: true,
    email: key === 'payment_failed',
    slack: false,
  })),
  categories: NOTIFICATION_CATEGORY_KEYS.map((key) => ({
    key,
    inapp: true,
    email: false,
    slack: false,
  })),
  slackWebhook: null,
  slackWebhookSet: false,
  isOwner: true,
  emailLive: true,
});

describe('Settings tab shell (TW-ASHELL-032)', () => {
  it('reads ?tab= and treats anything unknown as General', () => {
    expect(parseTab('notifications')).toBe('notifications');
    expect(parseTab('data')).toBe('data');
    expect(parseTab('nope')).toBe('general');
    expect(parseTab(null)).toBe('general');
    expect(parseTab('security')).toBe('security');
  });

  it('has the nine Reference tabs in two rail groups, and links the ones another domain owns', () => {
    expect(SETTINGS_TABS).toHaveLength(9);
    expect(TAB_GROUPS.flatMap((g) => g.tabs).sort()).toEqual([...SETTINGS_TABS].sort());
    expect(TAB_GROUPS[0]?.tabs).toEqual(['general', 'branding', 'team', 'notifications', 'aikeys']);
    expect(Object.keys(TAB_LINKS).sort()).toEqual(['aikeys', 'security', 'team']);
  });
});

describe('General tab (TW-ASHELL-033)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists UTC and the workspace zone first, once each', () => {
    const zones = timeZoneList('Asia/Kolkata');
    expect(zones[0]).toBe('UTC');
    expect(zones[1]).toBe('Asia/Kolkata');
    expect(new Set(zones).size).toBe(zones.length);
  });

  it('filters zones by a search that ignores case and reads _ as a space', () => {
    const zones = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Asia/Kolkata'];
    expect(filterTimeZones(zones, 'new york')).toEqual(['America/New_York']);
    expect(filterTimeZones(zones, 'AMERICA/')).toEqual(['America/New_York', 'America/Los_Angeles']);
    expect(filterTimeZones(zones, '  kolkata ')).toEqual(['Asia/Kolkata']);
    expect(filterTimeZones(zones, 'mars')).toEqual([]);
  });

  it('keeps every zone, in order, when the search is empty', () => {
    const zones = ['UTC', 'Asia/Kolkata'];
    expect(filterTimeZones(zones, '')).toEqual(zones);
    expect(filterTimeZones(zones, '   ')).toEqual(zones);
  });

  it('keeps Asia/Kolkata selectable after the workspace moves off it, even when the browser lists only Asia/Calcutta', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue([
      'Asia/Calcutta',
      'Asia/Colombo',
      'Asia/Jerusalem',
      'Europe/London',
    ]);
    const zones = timeZoneList('Asia/Colombo');
    expect(zones).toContain('Asia/Kolkata');
    expect(zones).not.toContain('Asia/Calcutta');
    expect(zones.filter((z) => z === 'Asia/Colombo')).toHaveLength(1);
    expect(zones.indexOf('Asia/Kolkata')).toBeLessThan(zones.indexOf('Europe/London'));
  });
});

describe('Notification matrix (TW-ASHELL-038)', () => {
  it('turns one channel of one event off without touching the rest', () => {
    const m = toMatrix(prefs());
    const next = toggleFlag(m, 'events', 'payment_failed', 'email', false);
    expect(next.events.payment_failed).toEqual({ inapp: true, email: false, slack: false });
    expect(next.events.device_connected).toEqual(m.events.device_connected);
    expect(m.events.payment_failed!.email).toBe(true);
  });

  it('posts all 18 events and 9 categories with every channel spelled out, like Reference hidden zeros', () => {
    const body = toRequest(toggleFlag(toMatrix(prefs()), 'categories', 'chat', 'slack', true), ' ');
    expect(Object.keys(body.events!)).toHaveLength(18);
    expect(Object.keys(body.categories!)).toHaveLength(9);
    expect(body.events!.payment_failed).toEqual({ inapp: true, email: true, slack: false });
    expect(body.categories!.chat).toEqual({ inapp: true, email: false, slack: true });
    expect(body.slackWebhook).toBe('');
  });
});

describe('Delete workspace (TW-ASHELL-044)', () => {
  it('stays disabled until a name and a password are given', () => {
    expect(canSubmitDelete('', 'x')).toBe(false);
    expect(canSubmitDelete('Acme', '')).toBe(false);
    expect(canSubmitDelete('  ', 'x')).toBe(false);
    expect(canSubmitDelete('Acme', 'x')).toBe(true);
  });
});

describe('workspace settings messages', () => {
  const en = JSON.parse(
    readFileSync(join(process.cwd(), 'messages', 'en', 'admin-console-shell.json'), 'utf8'),
  ) as { 'admin-console-shell': { workspaceSettings: Record<string, unknown> } };
  const ws = en['admin-console-shell'].workspaceSettings as {
    notifications: { events: Record<string, string>; categories: Record<string, string> };
  };
  it('names every notification event and category the API can return', () => {
    expect(Object.keys(ws.notifications.events).sort()).toEqual(
      [...NOTIFICATION_EVENT_KEYS].sort(),
    );
    expect(Object.keys(ws.notifications.categories).sort()).toEqual(
      [...NOTIFICATION_CATEGORY_KEYS].sort(),
    );
  });
});

describe('branding form logic (TW-ASHELL-036)', () => {
  it('reads only well-formed #RRGGBB colours, in lower case', () => {
    expect(normaliseColour(' #5B3D8A ')).toBe('#5b3d8a');
    expect(normaliseColour('red')).toBeNull();
    expect(normaliseColour('#12345')).toBeNull();
    expect(normaliseColour('#12345g')).toBeNull();
  });

  it('sends a colour only when the owner edited it', () => {
    expect(colourChanged('#075E54', '#075e54')).toBe(false);
    expect(colourChanged('#111111', '#075e54')).toBe(true);
    expect(DEFAULT_BRAND.primary).toBe('#075E54');
  });
});
