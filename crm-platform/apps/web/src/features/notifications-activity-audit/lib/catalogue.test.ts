import { describe, expect, it } from 'vitest';
import { NOTIFICATION_CATALOG, NOTIFICATION_PREF_TYPES } from '@crm/contracts';
import {
  FALLBACK_META,
  NOTIFICATION_ICONS,
  TYPE_CATALOGUE,
  isKnownType,
  notificationHref,
  safeLink,
  toastLifetimeMs,
  typeMeta,
  typesOfGroup,
} from './catalogue';

const ID = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const link = (type: string, data: Record<string, unknown> | null, extra = {}) =>
  notificationHref({ type, link: null, data, ...extra });

describe('the type catalogue', () => {
  it('covers every type a person can set preferences for, with the contracts group and defaults', () => {
    for (const type of NOTIFICATION_PREF_TYPES) {
      const meta = typeMeta(type);
      expect(isKnownType(type), type).toBe(true);
      expect(meta.group, type).toBe(NOTIFICATION_CATALOG[type].group);
      expect(meta.toast, type).toBe(NOTIFICATION_CATALOG[type].toast);
      expect(meta.sound, type).toBe(NOTIFICATION_CATALOG[type].sound);
      expect(NOTIFICATION_ICONS, type).toContain(meta.icon);
    }
  });

  it('draws problems in the danger tone and finished work in the success tone', () => {
    for (const type of [
      'device_disconnected',
      'device_logged_out',
      'broadcast_failed',
      'campaign_failed',
      'scheduled_failed',
      'wallet_low_balance',
    ]) {
      expect(typeMeta(type).tone, type).toBe('danger');
    }
    for (const type of [
      'device_connected',
      'broadcast_completed',
      'campaign_completed',
      'scheduled_completed',
      'task_completed',
    ]) {
      expect(typeMeta(type).tone, type).toBe('success');
    }
    expect(typeMeta('new_message').tone).toBe('info');
  });

  it('gives the waiting nudge its own clock icon, the chat group and a quiet-but-pushed default (BL-098)', () => {
    expect(typeMeta('chat_waiting')).toMatchObject({
      group: 'conversations',
      icon: 'waiting',
      tone: 'info',
      toast: true,
      sound: false,
      push: true,
      subject: 'conversation',
    });
    expect(typesOfGroup('conversations')).toContain('chat_waiting');
  });

  it('gives each phase 2 type its icon', () => {
    expect(typeMeta('device_connected').icon).toBe('device_on');
    expect(typeMeta('device_disconnected').icon).toBe('device_off');
    expect(typeMeta('device_logged_out').icon).toBe('device_off');
    expect(typeMeta('broadcast_failed').icon).toBe('broadcast');
    expect(typeMeta('campaign_completed').icon).toBe('campaign');
    expect(typeMeta('scheduled_failed').icon).toBe('schedule');
    expect(typeMeta('teamchat_mention').icon).toBe('mention');
    expect(typeMeta('teamchat_message').icon).toBe('team_chat');
  });

  it('treats a type it does not know as a quiet bell row', () => {
    expect(isKnownType('something_new')).toBe(false);
    expect(typeMeta('something_new')).toEqual(FALLBACK_META);
    expect(FALLBACK_META.toast).toBe(false);
    expect(FALLBACK_META.sound).toBe(false);
    // not an inherited property of the table either
    expect(isKnownType('constructor')).toBe(false);
  });

  it('lists the types of a group in catalogue order', () => {
    expect(typesOfGroup('devices')).toEqual([
      'device_connected',
      'device_disconnected',
      'device_logged_out',
    ]);
    expect(typesOfGroup('team_chat')).toEqual(['teamchat_mention', 'teamchat_message']);
    expect(Object.keys(TYPE_CATALOGUE)).toHaveLength(NOTIFICATION_PREF_TYPES.length);
  });

  it('keeps a problem toast on screen longer than a plain one', () => {
    expect(toastLifetimeMs('danger')).toBe(9_000);
    expect(toastLifetimeMs('info')).toBe(5_000);
    expect(toastLifetimeMs('success')).toBe(5_000);
  });
});

describe('where a notification opens', () => {
  it('uses the server link when it is an app path', () => {
    expect(link('device_disconnected', { deviceId: ID(1) }, { link: '/devices/other' })).toBe(
      '/devices/other',
    );
  });

  it('ignores a server link that leaves the app', () => {
    for (const bad of ['https://evil.test', '//evil.test', 'javascript:alert(1)']) {
      expect(safeLink(bad), bad).toBeNull();
    }
    expect(link('device_connected', { deviceId: ID(1) }, { link: 'https://evil.test' })).toBe(
      `/devices/${ID(1)}`,
    );
  });

  it('opens a device at /devices/<id>', () => {
    for (const type of ['device_connected', 'device_disconnected', 'device_logged_out']) {
      expect(link(type, { deviceId: ID(1) }), type).toBe(`/devices/${ID(1)}`);
    }
  });

  it('opens a broadcast, a campaign and a scheduled message at their own detail', () => {
    expect(link('broadcast_completed', { kind: 'broadcast', id: ID(2) })).toBe(
      `/broadcasts/${ID(2)}`,
    );
    expect(link('broadcast_failed', { kind: 'broadcast', id: ID(2) })).toBe(`/broadcasts/${ID(2)}`);
    expect(link('campaign_failed', { kind: 'campaign', id: ID(3) })).toBe(`/campaigns/${ID(3)}`);
    expect(link('scheduled_completed', { kind: 'scheduled_message', id: ID(4) })).toBe(
      `/scheduled/${ID(4)}`,
    );
  });

  it('opens a team chat mention or direct message in that channel', () => {
    expect(link('teamchat_mention', { channelId: ID(5) })).toBe(`/team-chat?c=${ID(5)}`);
    expect(link('teamchat_message', { channelId: ID(5), direct: true })).toBe(
      `/team-chat?c=${ID(5)}`,
    );
  });

  it('opens a waiting nudge in the Inbox with the thread open', () => {
    expect(link('chat_waiting', { conversationId: ID(6) })).toBe(`/inbox?c=${ID(6)}`);
    expect(link('chat_waiting', null, { subject: { kind: 'conversation', id: ID(7) } })).toBe(
      `/inbox?c=${ID(7)}`,
    );
  });

  it('opens a conversation in the Inbox with the thread open', () => {
    expect(link('new_message', { conversationId: ID(6) })).toBe(`/inbox?c=${ID(6)}`);
    expect(link('mention', null, { subject: { kind: 'conversation', id: ID(7) } })).toBe(
      `/inbox?c=${ID(7)}`,
    );
  });

  it('falls back to the row subject, and to nothing when there is nothing to open', () => {
    expect(link('device_disconnected', null, { subject: { kind: 'device', id: ID(8) } })).toBe(
      `/devices/${ID(8)}`,
    );
    expect(link('device_disconnected', null)).toBeNull();
    expect(link('task_due', null)).toBeNull();
    expect(link('something_new', { id: ID(9) })).toBeNull();
  });

  it('never builds a link from an id that is not a uuid', () => {
    expect(link('device_connected', { deviceId: '../../admin' })).toBeNull();
    expect(link('broadcast_failed', { kind: 'broadcast', id: '1; drop' })).toBeNull();
    expect(link('broadcast_failed', { kind: 'campaign', id: ID(1) })).toBeNull();
  });
});

describe('the WhatsApp Groups types (BL-099)', () => {
  it('belong to their own group with a group icon, and a problem is drawn in the danger tone', () => {
    expect(typesOfGroup('whatsapp_groups')).toEqual([
      'waba_group_join_request',
      'waba_group_suspended',
      'waba_group_suspension_cleared',
      'device_group_join_request',
      'device_group_removed',
    ]);
    expect(typeMeta('waba_group_join_request')).toMatchObject({ icon: 'group', tone: 'info' });
    expect(typeMeta('waba_group_suspended').tone).toBe('danger');
    expect(typeMeta('waba_group_suspension_cleared').tone).toBe('success');
  });

  it('opens the Groups screen on the number, and plain /waba-groups when the row names none', () => {
    const conn = '33333333-3333-4333-8333-333333333333';
    expect(
      notificationHref({
        type: 'waba_group_join_request',
        link: null,
        data: { connectionId: conn },
      }),
    ).toBe(`/waba-groups?account=${conn}`);
    expect(notificationHref({ type: 'waba_group_suspended', link: null, data: {} })).toBe(
      '/waba-groups',
    );
    expect(
      notificationHref({
        type: 'waba_group_suspended',
        link: '/waba-groups?account=x',
        data: {},
      }),
    ).toBe('/waba-groups?account=x');
  });
});

describe('the personal-number Groups types', () => {
  const dev = '44444444-4444-4444-8444-444444444444';

  it('are in the WhatsApp groups section with the quiet defaults and no push; a removal is a problem', () => {
    expect(typeMeta('device_group_join_request')).toMatchObject({
      group: 'whatsapp_groups',
      icon: 'group',
      tone: 'info',
      toast: true,
      sound: false,
      push: false,
    });
    expect(typeMeta('device_group_removed')).toMatchObject({
      group: 'whatsapp_groups',
      icon: 'group',
      tone: 'danger',
      push: false,
    });
  });

  it('opens the Groups tab of /devices on the number, and plain /devices/groups when the row names none', () => {
    expect(
      notificationHref({ type: 'device_group_join_request', link: null, data: { deviceId: dev } }),
    ).toBe(`/devices/groups?device=${dev}`);
    expect(notificationHref({ type: 'device_group_removed', link: null, data: {} })).toBe(
      '/devices/groups',
    );
  });

  it('never builds the link from an id that is not a uuid, and keeps the server link when it sent one', () => {
    expect(
      notificationHref({
        type: 'device_group_removed',
        link: null,
        data: { deviceId: '../../admin' },
      }),
    ).toBe('/devices/groups');
    expect(
      notificationHref({
        type: 'device_group_removed',
        link: `/devices/groups?device=${dev}`,
        data: {},
      }),
    ).toBe(`/devices/groups?device=${dev}`);
  });
});
