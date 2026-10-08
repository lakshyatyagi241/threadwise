import { describe, expect, it } from 'vitest';
import {
  GROUP_NOTIFY_EVENTS,
  groupFlagCopy,
  groupFlagKey,
  groupLabel,
  groupNoticeFor,
  groupRequestCollapseKey,
  groupRequestCopy,
  groupRequestKey,
} from '../../../src/modules/notifications/group-notification-rules';

describe('which notice a group event stands for (BL-099)', () => {
  it('a new join request is a collapsing notice with its count; a missing count is one', () => {
    expect(
      groupNoticeFor('whatsapp.group.join_request', { handled: null, count: 3, pending: 3 }),
    ).toEqual({ kind: 'requested', type: 'waba_group_join_request', count: 3 });
    expect(groupNoticeFor('whatsapp.group.join_request', {})).toEqual({
      kind: 'requested',
      type: 'waba_group_join_request',
      count: 1,
    });
    expect(groupNoticeFor('whatsapp.group.join_request', { count: 0 })).toBeNull();
  });

  it('a request that was approved, rejected or revoked is only a settle, never a new row', () => {
    for (const handled of ['approved', 'rejected', 'revoked']) {
      expect(groupNoticeFor('whatsapp.group.join_request', { handled, count: 2 })).toEqual({
        kind: 'settled',
      });
    }
  });

  it('the suspended flag flips both ways, and a payload without the flag says nothing', () => {
    expect(groupNoticeFor('whatsapp.group.suspended', { suspended: true })).toEqual({
      kind: 'suspended',
      type: 'waba_group_suspended',
    });
    expect(groupNoticeFor('whatsapp.group.suspended', { suspended: false })).toEqual({
      kind: 'cleared',
      type: 'waba_group_suspension_cleared',
    });
    expect(groupNoticeFor('whatsapp.group.suspended', {})).toBeNull();
  });

  it('ignores every other event and listens to exactly the two that notify', () => {
    for (const t of ['whatsapp.group.created', 'whatsapp.group.updated', 'whatsapp.group.deleted'])
      expect(groupNoticeFor(t, { suspended: true, count: 2 })).toBeNull();
    expect([...GROUP_NOTIFY_EVENTS]).toEqual([
      'whatsapp.group.join_request',
      'whatsapp.group.suspended',
    ]);
  });
});

describe('the words of a group row', () => {
  it('names the group, counts the people, and never invents a number or a link', () => {
    expect(groupRequestCopy('Sales club', 1).title).toBe('Someone wants to join Sales club');
    const many = groupRequestCopy('Sales club', 10);
    expect(many.title).toBe('10 people want to join Sales club');
    expect(`${many.title} ${many.body}`).not.toMatch(/https?:|\+?\d{8,}/);
  });

  it('a group with no subject yet is "a WhatsApp group"; a long or multi-line subject is one cut line', () => {
    expect(groupLabel(null)).toBe('a WhatsApp group');
    expect(groupLabel('   ')).toBe('a WhatsApp group');
    expect(groupLabel('a\n b')).toBe('a b');
    expect(groupLabel('y'.repeat(300)).length).toBe(80);
  });

  it('says suspended and active again', () => {
    expect(groupFlagCopy('waba_group_suspended', 'Sales club').title).toBe(
      'Sales club was suspended',
    );
    expect(groupFlagCopy('waba_group_suspension_cleared', 'Sales club').title).toBe(
      'Sales club is active again',
    );
  });

  it('keys end in the outbox event id, which the collapsing writer reads back', () => {
    expect(groupRequestKey('g1', '42').split(':').pop()).toBe('42');
    expect(groupFlagKey('g1', '43').split(':').pop()).toBe('43');
    expect(groupRequestCollapseKey('g1')).toBe('wgjr:g1');
  });
});
