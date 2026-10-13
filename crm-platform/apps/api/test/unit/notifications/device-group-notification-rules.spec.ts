import { describe, expect, it } from 'vitest';
import { NOTIFICATION_CATALOG, NOTIFICATION_TYPES } from '@crm/contracts';
import {
  DEVICE_GROUP_NOTIFY_EVENTS,
  deviceGroupNoticeFor,
  deviceGroupRemovedCopy,
  deviceGroupRemovedKey,
  deviceGroupRequestCollapseKey,
  deviceGroupRequestCopy,
  deviceGroupRequestKey,
} from '../../../src/modules/notifications/device-group-notification-rules';
import { pushText } from '../../../src/modules/notifications/push-payload';

describe('which notice a personal-group event stands for', () => {
  it('new join requests collapse into one row with their count; a missing count is one', () => {
    expect(
      deviceGroupNoticeFor('whatsapp.device_group.join_request', {
        handled: null,
        added: 3,
        pending: 3,
      }),
    ).toEqual({ kind: 'requested', type: 'device_group_join_request', count: 3 });
    expect(deviceGroupNoticeFor('whatsapp.device_group.join_request', {})).toEqual({
      kind: 'requested',
      type: 'device_group_join_request',
      count: 1,
    });
    expect(deviceGroupNoticeFor('whatsapp.device_group.join_request', { added: 0 })).toBeNull();
  });

  it('a queue that shrank is only a settle, never a new row', () => {
    expect(
      deviceGroupNoticeFor('whatsapp.device_group.join_request', {
        handled: 'settled',
        pending: 0,
      }),
    ).toEqual({ kind: 'settled' });
  });

  it('only a removal by someone else is news; leaving by ourselves is not', () => {
    expect(deviceGroupNoticeFor('whatsapp.device_group.left', { removed: true })).toEqual({
      kind: 'removed',
      type: 'device_group_removed',
    });
    expect(deviceGroupNoticeFor('whatsapp.device_group.left', { removed: false })).toBeNull();
    expect(deviceGroupNoticeFor('whatsapp.device_group.left', {})).toBeNull();
  });

  it('listens to exactly the two events that notify and ignores the rest', () => {
    expect([...DEVICE_GROUP_NOTIFY_EVENTS]).toEqual([
      'whatsapp.device_group.join_request',
      'whatsapp.device_group.left',
    ]);
    for (const t of ['created', 'updated', 'participants_changed'])
      expect(
        deviceGroupNoticeFor(`whatsapp.device_group.${t}`, { added: 2, removed: true }),
      ).toBeNull();
  });
});

describe('the words and keys of a personal-group row', () => {
  it('names the group and counts people, never a number', () => {
    expect(deviceGroupRequestCopy('Sales club', 1).title).toBe('Someone wants to join Sales club');
    expect(deviceGroupRequestCopy('Sales club', 10).title).toBe(
      '10 people want to join Sales club',
    );
    expect(deviceGroupRequestCopy(null, 2).title).toBe('2 people want to join a WhatsApp group');
  });

  it('a removal names the group and the number by its label only', () => {
    const c = deviceGroupRemovedCopy('Sales club', 'Shop line');
    expect(c.title).toBe('Removed from Sales club');
    expect(c.body).toContain('Shop line');
    expect(`${c.title} ${c.body}`).not.toMatch(/\d{6,}/);
    expect(deviceGroupRemovedCopy(null, null).body).toMatch(/This number/);
  });

  it('keys: one collapse key per group, redelivery keys end in the event id', () => {
    expect(deviceGroupRequestCollapseKey('g1')).toBe('dgjr:g1');
    expect(deviceGroupRequestKey('g1', '42')).toBe('dgjr:g1:42');
    expect(deviceGroupRemovedKey('g1', '42')).toBe('dgrm:g1:42');
  });
});

describe('the catalogue and the push of these two types', () => {
  it('are known types with push off by default and the shared group', () => {
    for (const t of ['device_group_join_request', 'device_group_removed'] as const) {
      expect(NOTIFICATION_TYPES).toContain(t);
      expect(NOTIFICATION_CATALOG[t]).toMatchObject({ group: 'whatsapp_groups', push: false });
    }
  });

  it('a push carries the group name and the kind of event, never the row sentence or a number', () => {
    const base = {
      body: 'Shop line was removed ... 919800000001',
      data: { groupName: 'Sales club' },
    };
    expect(
      pushText({ ...base, type: 'device_group_removed', title: 't', eventCount: 1 } as never),
    ).toEqual({
      title: 'Sales club',
      body: 'Removed from group',
    });
    expect(
      pushText({ ...base, type: 'device_group_join_request', title: 't', eventCount: 4 } as never),
    ).toEqual({ title: 'Sales club', body: '4 join requests' });
  });
});
