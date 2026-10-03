import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_CATEGORY_KEYS,
  NOTIFICATION_EVENT_KEYS,
  type NotificationPrefsResponse,
} from '@crm/contracts';
import { canSubmitDelete, parseTab, timeZoneList, toMatrix, toRequest, toggleFlag } from './logic';

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
  });
});

describe('General tab (TW-ASHELL-033)', () => {
  it('lists UTC and the workspace zone first, once each', () => {
    const zones = timeZoneList('Asia/Kolkata');
    expect(zones[0]).toBe('UTC');
    expect(zones[1]).toBe('Asia/Kolkata');
    expect(new Set(zones).size).toBe(zones.length);
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
