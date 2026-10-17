import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Templates an agent can send from a conversation (`GET /v2/inbox/conversations/:id/templates`, then `POST .../messages` with
 * `kind: 'template'`). Every approved template of the workspace is listed, as Reference does. One that cannot be sent from this
 * conversation is listed too, disabled, with the reason: a template of another WhatsApp number, or a conversation whose channel is
 * not linked to a number, so it is never a mystery why a template known from the library is not offered.
 */

/** Why an approved template cannot be sent from the inbox (yet). */
export const INBOX_TEMPLATE_BLOCK_REASONS = [
  /** The template belongs to another WhatsApp number than the conversation's. Meta would refuse it for this number. */
  'other_number',
  /** The conversation's channel is not linked to a WhatsApp number, so no template can be sent from it. */
  'not_linked',
  /** Approved, but paused by Meta (quality) until the pause ends. */
  'paused',
  /** The header is an image, video, document or location: the inbox has nowhere to put the file. */
  'media_header',
  /** The header carries a variable. */
  'header_variable',
  /** A button's link has a variable. */
  'dynamic_button',
  /** One-time-password templates are sent by the system, not typed by an agent. */
  'authentication',
  /** Named variables (`{{first_name}}`) rather than `{{1}}`: not supported by the picker yet. */
  'named_variables',
] as const;
export const inboxTemplateBlockReasonSchema = z.enum(INBOX_TEMPLATE_BLOCK_REASONS);
export type InboxTemplateBlockReason = z.infer<typeof inboxTemplateBlockReasonSchema>;

/** One `{{n}}` of the body: `key` is what the send carries, `label` what the agent is asked for. */
export const inboxTemplateSlotSchema = z.object({
  key: z.string(),
  label: z.string(),
  example: z.string().nullable(),
});
export type InboxTemplateSlot = z.infer<typeof inboxTemplateSlotSchema>;

export const inboxTemplateOptionSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  language: z.string(),
  category: z.string(),
  header: z.string().nullable(),
  body: z.string(),
  footer: z.string().nullable(),
  buttons: z.array(z.string()),
  slots: z.array(inboxTemplateSlotSchema),
  sendable: z.boolean(),
  reason: inboxTemplateBlockReasonSchema.nullable(),
});
export type InboxTemplateOption = z.infer<typeof inboxTemplateOptionSchema>;

export const listInboxTemplatesQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
});
export type ListInboxTemplatesQuery = z.infer<typeof listInboxTemplatesQuerySchema>;

/** The most templates one answer carries; a number can have over a thousand, so the picker narrows by search. */
export const INBOX_TEMPLATE_LIST_MAX = 200;

export const inboxTemplateListResponseSchema = z.object({
  data: z.array(inboxTemplateOptionSchema),
  /** More approved templates match than were returned: the picker tells the agent to search. */
  hasMore: z.boolean(),
});
export type InboxTemplateListResponse = z.infer<typeof inboxTemplateListResponseSchema>;
