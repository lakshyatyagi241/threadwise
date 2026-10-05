import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Reply-only sends (WD-IG-013, 014). Instagram only lets an account message someone who has already written to it, so the
 * recipients are existing threads, never numbers. Nothing is kept as a broadcast record (WaDesk kept none): the answer carries the
 * counts, and each message that went is mirrored into its thread.
 */

/** The most threads one send reaches: WaDesk's inbox composer cut at 200, and a request waits for every send. */
export const IG_SEND_MAX = 200;

export const igComposeSchema = z.object({
  /** The linked accounts that are connected; empty while the engine is off. */
  accounts: z.array(
    z.object({
      id: uuidSchema,
      instaflowAccountId: z.string(),
      /** `@handle` without a doubled @. */
      handle: z.string(),
    }),
  ),
  /** Each account's threads (newest customer message first, at most 2000), by the engine's account id. */
  threads: z.record(
    z.string(),
    z.array(
      z.object({
        id: uuidSchema,
        title: z.string(),
        /** Inside Instagram's 24 hour window: a plain message will reach them. The engine enforces it at send time. */
        windowOpen: z.boolean(),
      }),
    ),
  ),
  /** Instagram templates: an optional prefill for the message. */
  templates: z.array(
    z.object({ id: uuidSchema, name: z.string(), body: z.string(), buttons: z.array(z.unknown()) }),
  ),
});
export type IgCompose = z.infer<typeof igComposeSchema>;

/** The broadcasts page: a name, a message (`{name}` becomes the person's name) and the threads to send to. */
export const sendIgBroadcastSchema = z.object({
  name: z.string().trim().min(1).max(255),
  message: z.string().trim().min(1).max(1000),
  threadIds: z.array(uuidSchema).min(1).max(IG_SEND_MAX),
});
export type SendIgBroadcastInput = z.infer<typeof sendIgBroadcastSchema>;

/** The inbox composer's Instagram tab: the same send with an optional template whose body and buttons replace the typed text. */
export const sendIgComposerSchema = z.object({
  body: z.string().trim().min(1).max(4096),
  threadIds: z.array(uuidSchema).min(1).max(IG_SEND_MAX),
  templateId: uuidSchema.optional(),
});
export type SendIgComposerInput = z.infer<typeof sendIgComposerSchema>;

export const igSendResultSchema = z.object({
  sent: z.number().int().min(0),
  failed: z.number().int().min(0),
  /** Up to five reasons, each cut to 120 characters. */
  errors: z.array(z.string()),
});
export type IgSendResult = z.infer<typeof igSendResultSchema>;
