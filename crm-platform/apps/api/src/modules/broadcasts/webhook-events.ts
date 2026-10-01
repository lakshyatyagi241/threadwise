/**
 * What a broadcast tells the outside world (WD-BCAST-029): outbound webhook events with WaDesk's names and payload keys, and
 * the in-app notification entries. Pure builders: the outbox event carries the finished result, so whoever delivers it (the
 * webhooks module for the former, the notifications module for the latter) only has to send it.
 *
 * Ids are the public uuids (broadcast, template, contact); `workspace_id` is added by the deliverer from the event's org.
 */

export interface BroadcastSnapshot {
  uuid: string;
  name: string;
  templateUuid: string | null;
  status: string;
  totalRecipients: number;
  successCount: number;
  deliveredCount: number;
  readCount: number;
  failCount: number;
  clickedCount: number;
}

export interface WebhookEventOut {
  event: string;
  data: Record<string, unknown>;
}

export interface NotificationOut {
  category: 'broadcast';
  severity: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  /** Null when the target no longer exists (a deleted broadcast). */
  actionUrl: string | null;
}

export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

/** Event names a customer can subscribe to for one recipient's message. */
export const MESSAGE_EVENTS: Record<MessageStatus, string> = {
  sent: 'message_sent',
  delivered: 'message_delivered',
  read: 'message_read',
  failed: 'message_failed',
};

const TERMINAL = new Set(['completed', 'completed_with_errors', 'failed']);

const unix = (d: Date) => Math.floor(d.getTime() / 1000);

const base = (b: BroadcastSnapshot, now: Date) => ({
  broadcast_id: b.uuid,
  broadcast_name: b.name,
  template_id: b.templateUuid,
  status: b.status,
  total_recipients: b.totalRecipients,
  timestamp: unix(now),
});

export const aggregateBlock = (b: BroadcastSnapshot) => ({
  sent: b.successCount,
  delivered: b.deliveredCount,
  read: b.readCount,
  failed: b.failCount,
  clicked: b.clickedCount,
  total: b.totalRecipients,
});

export function createdWebhook(b: BroadcastSnapshot, now: Date): WebhookEventOut[] {
  return [{ event: 'broadcast_created', data: base(b, now) }];
}

export function statusWebhook(
  b: BroadcastSnapshot,
  previousStatus: string | null,
  now: Date,
): WebhookEventOut[] {
  return [
    {
      event: 'broadcast_status_updated',
      data: {
        ...base(b, now),
        previous_status: previousStatus,
        success_count: b.successCount,
        delivered_count: b.deliveredCount,
        read_count: b.readCount,
        fail_count: b.failCount,
      },
    },
  ];
}

export interface MessageFact {
  status: MessageStatus;
  contactUuid: string;
  phone: string | null;
  providerMessageId: string | null;
  errorCode?: string | null;
  errorReason?: string | null;
  at: Date;
}

/**
 * One recipient's message. A send (the worker handing it to the provider) is `message_sent` / `message_failed`; a provider
 * receipt is the same plus `broadcast_message_status_updated`, which is what the reference fires for Meta's status webhooks.
 * Only the four tiers are events: pending and processing are internal.
 */
export function messageWebhooks(
  b: BroadcastSnapshot,
  m: MessageFact,
  source: 'send' | 'receipt',
): WebhookEventOut[] {
  const common = {
    broadcast_id: b.uuid,
    broadcast_name: b.name,
    template_id: b.templateUuid,
    contact_id: m.contactUuid,
    wamid: m.providerMessageId,
    status: m.status,
    timestamp: unix(m.at),
    aggregate: aggregateBlock(b),
  };
  const out: WebhookEventOut[] = [];
  if (source === 'receipt') {
    out.push({
      event: 'broadcast_message_status_updated',
      data: {
        ...common,
        phone: m.phone,
        error_code: m.errorCode ?? null,
        error_reason: m.errorReason ?? null,
      },
    });
  }
  out.push({
    event: MESSAGE_EVENTS[m.status],
    data: { ...common, error_reason: m.errorReason ?? null },
  });
  return out;
}

export interface ClickFact {
  campaignId: string | null;
  messageId: string | null;
  contactUuid: string;
  templateUuid: string | null;
  phone: string | null;
  originalUrl: string;
  token: string;
  ip: string;
  userAgent: string;
  at: Date;
}

export function clickWebhook(b: BroadcastSnapshot, c: ClickFact): WebhookEventOut[] {
  return [
    {
      event: 'campaign_contact_clicked',
      data: {
        broadcast_id: b.uuid,
        campaign_id: c.campaignId,
        message_id: c.messageId,
        contact_id: c.contactUuid,
        template_id: c.templateUuid,
        phone: c.phone,
        original_url: c.originalUrl,
        token: c.token,
        click_at: c.at.toISOString(),
        ip: c.ip,
        user_agent: c.userAgent,
      },
    },
  ];
}

/** The reference rings the bell on every save; the port keeps the meaningful ones (WD-BCAST-029 note 2): created, finished, deleted. */
export function createdNotification(b: BroadcastSnapshot): NotificationOut {
  return {
    category: 'broadcast',
    severity: 'info',
    title: 'Broadcast created',
    message: `Broadcast created: ${b.name}`,
    actionUrl: `/broadcasts/${b.uuid}`,
  };
}

/** Null for a status change that is not worth a bell entry (processing, paused, ...). */
export function statusNotification(b: BroadcastSnapshot): NotificationOut | null {
  if (!TERMINAL.has(b.status)) return null;
  return {
    category: 'broadcast',
    severity: b.status === 'failed' ? 'error' : b.status === 'completed' ? 'success' : 'warning',
    title: 'Broadcast updated',
    message: `Broadcast updated: ${b.name} (${b.status.replaceAll('_', ' ')})`,
    actionUrl: `/broadcasts/${b.uuid}`,
  };
}

export function deletedNotification(name: string): NotificationOut {
  return {
    category: 'broadcast',
    severity: 'warning',
    title: 'Broadcast deleted',
    message: `Broadcast deleted: ${name}`,
    actionUrl: null,
  };
}
