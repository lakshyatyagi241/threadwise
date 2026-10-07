import type { WebhookEventName } from '@crm/contracts';

/**
 * Which outbox event types become which webhook event. The webhook payload is the outbox payload (uuids and the facts the event
 * already carries), so nothing is looked up again at delivery time and a webhook never sees more than the event announced.
 */
export const OUTBOX_TO_WEBHOOK: Readonly<Record<string, WebhookEventName>> = {
  'contact.created': 'contact_created',
  'contact.updated': 'contact_updated',
  'contact.deleted': 'contact_deleted',
  'contact.tag_added': 'contact_tag_added',
  'contact.opt_in': 'contact_opted_in',
  'deal.stage_changed': 'deal_stage_changed',
  'task.created': 'task_created',
  'task.assigned': 'task_assigned',
  'template.status_changed': 'template_status_changed',
  'device.status_changed': 'device_status_changed',
  'conversation.reopened': 'conversation_reopened',
};

export const OUTBOX_EVENT_TYPES = Object.keys(OUTBOX_TO_WEBHOOK);

/** A subscription matches by exact name or by `*` (no prefixes or patterns). An empty list means everything. */
export function matches(subscribed: readonly string[] | null | undefined, event: string): boolean {
  if (!subscribed || subscribed.length === 0) return true;
  return subscribed.includes('*') || subscribed.includes(event);
}
