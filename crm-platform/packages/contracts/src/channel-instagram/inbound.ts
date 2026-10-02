import { z } from 'zod';

/**
 * What the Instagram engine pushes to `POST /instaflow/inbound` (TW-IG-007). The engine is a separate product, so the three bodies
 * are read leniently: only the event and the workspace are required, and every other field is picked out, never trusted.
 */
const loose = z.record(z.string(), z.unknown());

export const igInboundSchema = z.object({
  event: z.enum(['message', 'status', 'conversation']),
  /** The workspace (here: the organization) the event belongs to. */
  workspace_id: z.coerce.number().int().positive(),
  /** `{id, username, name, avatar}` of the Instagram account that received it. */
  account: loose.nullish(),
  /** `{id, name, handle, avatar}` of the thread. */
  conversation: loose.nullish(),
  /** `{id, from_me, type, text, media_url, buttons, at, ig_trigger, is_test, is_backfill, trace_id}`. */
  message: loose.nullish(),
});
export type IgInbound = z.infer<typeof igInboundSchema>;

export const igInboundResultSchema = z.object({
  ok: z.literal(true),
  /** Set for a `message` event. */
  message_id: z.number().int().optional(),
  conversation_id: z.number().int().optional(),
  /** Set for an event that is acknowledged and not stored (`status`, `conversation`). */
  received: z.string().optional(),
});
export type IgInboundResult = z.infer<typeof igInboundResultSchema>;
