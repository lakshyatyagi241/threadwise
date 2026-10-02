import { describe, expect, it } from 'vitest';
import {
  createdWebhook,
  statusNotification,
  statusWebhook,
  type CampaignSnapshot,
} from '../../../src/modules/campaigns/campaign-webhook-events';

const snap = (over: Partial<CampaignSnapshot> = {}): CampaignSnapshot => ({
  uuid: 'c-1',
  name: 'Promo',
  type: 'template',
  status: 'running',
  scheduleType: 'now',
  totalRecipients: 10,
  sent: 4,
  delivered: 3,
  read: 2,
  failed: 1,
  responded: 1,
  createdBy: 7,
  ...over,
});

const NOW = new Date('2026-10-02T10:00:00Z');

describe('campaign webhook events', () => {
  it('campaign_created carries WaDesk keys', () => {
    expect(createdWebhook(snap(), NOW)).toEqual([
      {
        event: 'campaign_created',
        data: {
          user_id: 7,
          campaign_id: 'c-1',
          campaign_name: 'Promo',
          campaign_type: 'template',
          status: 'running',
          schedule_type: 'now',
          total_recipients: 10,
          timestamp: 1790935200,
        },
      },
    ]);
  });

  it('campaign_status_updated carries the previous status and every count', () => {
    const [e] = statusWebhook(snap({ status: 'completed' }), 'running', NOW);
    expect(e!.event).toBe('campaign_status_updated');
    expect(e!.data).toMatchObject({
      status: 'completed',
      previous_status: 'running',
      sent_count: 4,
      delivered_count: 3,
      read_count: 2,
      failed_count: 1,
      responded_count: 1,
    });
  });
});

describe('campaign bell', () => {
  it('rings for completed and failed only', () => {
    expect(statusNotification(snap({ status: 'completed' }))).toMatchObject({
      severity: 'success',
      title: 'Campaign completed',
      actionUrl: '/campaigns/c-1',
    });
    expect(statusNotification(snap({ status: 'failed' }))).toMatchObject({ severity: 'error' });
    for (const s of ['running', 'paused', 'cancelled', 'scheduled', 'draft']) {
      expect(statusNotification(snap({ status: s }))).toBeNull();
    }
  });
});
