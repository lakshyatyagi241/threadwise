import { describe, expect, it } from 'vitest';
import {
  clickWebhook,
  createdNotification,
  createdWebhook,
  deletedNotification,
  messageWebhooks,
  statusNotification,
  statusWebhook,
  type BroadcastSnapshot,
} from '../../../src/modules/broadcasts/webhook-events';

const b: BroadcastSnapshot = {
  uuid: 'b-1',
  name: 'Diwali',
  templateUuid: 't-1',
  status: 'processing',
  totalRecipients: 10,
  successCount: 4,
  deliveredCount: 3,
  readCount: 1,
  failCount: 2,
  clickedCount: 1,
};
const now = new Date('2026-10-02T10:00:00Z');
const unix = now.getTime() / 1000;

describe('webhook events (WD-BCAST-029)', () => {
  it('broadcast_created has the WaDesk keys', () => {
    expect(createdWebhook(b, now)).toEqual([
      {
        event: 'broadcast_created',
        data: {
          broadcast_id: 'b-1',
          broadcast_name: 'Diwali',
          template_id: 't-1',
          status: 'processing',
          total_recipients: 10,
          timestamp: unix,
        },
      },
    ]);
  });

  it('broadcast_status_updated adds previous_status and counts', () => {
    expect(statusWebhook(b, 'scheduled', now)[0]!.data).toMatchObject({
      previous_status: 'scheduled',
      success_count: 4,
      delivered_count: 3,
      read_count: 1,
      fail_count: 2,
    });
  });

  it('a send is one event, a receipt adds broadcast_message_status_updated first', () => {
    const m = {
      status: 'read' as const,
      contactUuid: 'c-1',
      phone: '+91',
      providerMessageId: 'w',
      at: now,
    };
    expect(messageWebhooks(b, m, 'send').map((e) => e.event)).toEqual(['message_read']);
    const r = messageWebhooks(b, { ...m, errorCode: '1' }, 'receipt');
    expect(r.map((e) => e.event)).toEqual(['broadcast_message_status_updated', 'message_read']);
    expect(r[1]!.data.aggregate).toEqual({
      sent: 4,
      delivered: 3,
      read: 1,
      failed: 2,
      clicked: 1,
      total: 10,
    });
    expect(r[0]!.data).toMatchObject({ phone: '+91', error_code: '1' });
  });

  it('a click carries the url, token and visitor', () => {
    const e = clickWebhook(b, {
      campaignId: null,
      messageId: null,
      contactUuid: 'c-1',
      templateUuid: 't-1',
      phone: null,
      originalUrl: 'https://x.test',
      token: 'tok',
      ip: '1.1.1.1',
      userAgent: 'UA',
      at: now,
    })[0]!;
    expect(e.event).toBe('campaign_contact_clicked');
    expect(e.data).toMatchObject({
      original_url: 'https://x.test',
      ip: '1.1.1.1',
      click_at: now.toISOString(),
    });
  });
});

describe('notifications', () => {
  it('created links to the broadcast; deleted is a warning with no link', () => {
    expect(createdNotification(b).actionUrl).toBe('/broadcasts/b-1');
    expect(deletedNotification('Diwali')).toMatchObject({ severity: 'warning', actionUrl: null });
  });

  it('only finished states ring the bell', () => {
    expect(statusNotification(b)).toBeNull();
    expect(statusNotification({ ...b, status: 'paused' })).toBeNull();
    expect(statusNotification({ ...b, status: 'completed' })!.severity).toBe('success');
    expect(statusNotification({ ...b, status: 'completed_with_errors' })!.severity).toBe('warning');
    expect(statusNotification({ ...b, status: 'failed' })!.severity).toBe('error');
  });
});
