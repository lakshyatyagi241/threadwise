import type { FlowRunSource, PurposeInput } from '@crm/contracts';

/**
 * The runs that start because the BUSINESS decided to reach a contact: on the clock, from a list change, a campaign, a lead or an
 * API call. Their free-form messages are marketing, so a contact who unsubscribed is not reached by them (BL-141). Every other source
 * answers something the contact did (a keyword, any message, an order, a routing hop) and its messages are service replies.
 */
export const PROACTIVE_FLOW_SOURCES: ReadonlySet<FlowRunSource> = new Set<FlowRunSource>([
  'schedule',
  'date_field_match',
  'campaign',
  'field_match',
  'segment_join',
  'segment_leave',
  'tag_added',
  'group_join',
  'group_leave',
  'contact_created',
  'contact_updated',
  'webhook_lead',
  'api',
  'manual',
]);

/**
 * The purpose of one flow message. A template takes its category (`templatePurpose`, looked up by the sender); anything else is
 * marketing for a proactive run and service for a reply run.
 */
export function flowMessagePurpose(
  source: FlowRunSource,
  template: PurposeInput | null,
): PurposeInput {
  if (template !== null) return template;
  return PROACTIVE_FLOW_SOURCES.has(source) ? 'marketing_messaging' : 'service_messaging';
}
