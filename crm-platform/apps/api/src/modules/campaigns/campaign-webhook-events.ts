/**
 * What a campaign tells the outside world (WD-CAMP-024): outbound webhook events with WaDesk's names and payload keys, and the
 * in-app bell entries. Pure builders: the outbox event carries the finished result (`webhook`, `notification`), so whoever delivers
 * it only has to send it. Same shape as the broadcasts builders.
 *
 * WaDesk fires exactly two webhook events from the model, `campaign_created` and `campaign_status_updated`; its bell has
 * `campaign_completed` and `campaign_failed`. `workspace_id` is added by the deliverer from the event's org.
 */

export interface CampaignSnapshot {
  uuid: string;
  name: string;
  type: string;
  status: string;
  scheduleType: string;
  totalRecipients: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  responded: number;
  createdBy: number | null;
}

export interface WebhookEventOut {
  event: string;
  data: Record<string, unknown>;
}

export interface NotificationOut {
  category: 'campaign';
  severity: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  actionUrl: string;
}

const unix = (d: Date) => Math.floor(d.getTime() / 1000);

export function createdWebhook(c: CampaignSnapshot, now: Date): WebhookEventOut[] {
  return [
    {
      event: 'campaign_created',
      data: {
        user_id: c.createdBy,
        campaign_id: c.uuid,
        campaign_name: c.name,
        campaign_type: c.type,
        status: c.status,
        schedule_type: c.scheduleType,
        total_recipients: c.totalRecipients,
        timestamp: unix(now),
      },
    },
  ];
}

export function statusWebhook(
  c: CampaignSnapshot,
  previousStatus: string,
  now: Date,
): WebhookEventOut[] {
  return [
    {
      event: 'campaign_status_updated',
      data: {
        user_id: c.createdBy,
        campaign_id: c.uuid,
        campaign_name: c.name,
        status: c.status,
        previous_status: previousStatus,
        total_recipients: c.totalRecipients,
        sent_count: c.sent,
        delivered_count: c.delivered,
        read_count: c.read,
        failed_count: c.failed,
        responded_count: c.responded,
        timestamp: unix(now),
      },
    },
  ];
}

/** Only the two outcomes WaDesk rings the bell for. Null for any other status change. */
export function statusNotification(c: CampaignSnapshot): NotificationOut | null {
  if (c.status !== 'completed' && c.status !== 'failed') return null;
  const done = c.status === 'completed';
  return {
    category: 'campaign',
    severity: done ? 'success' : 'error',
    title: done ? 'Campaign completed' : 'Campaign failed',
    message: `Campaign ${done ? 'completed' : 'failed'}: ${c.name}`,
    actionUrl: `/campaigns/${c.uuid}`,
  };
}
