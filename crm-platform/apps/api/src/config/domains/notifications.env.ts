import { z } from 'zod';

/**
 * Settings of the live conversation notifications (BL-096, docs/specs/realtime-notifications.md sections 7.2 and 15). Read straight
 * from the environment (the central schema belongs to the kernel) and validated once per read; every value has a safe default.
 */
const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.string().optional(),
  /**
   * The quick off switch of new-chat / new-message / assignment / mention notifications (rollout, spec section 15). Off: the ingest
   * stops writing `message.received` and the consumer drops what is still queued. Default: on everywhere except production, where it
   * stays off until the parity run passes and the operator sets it.
   */
  NOTIFY_CONVERSATIONS_ENABLED: booleanish.optional(),
  /** The most people one event notifies (an unassigned new chat in a big workspace); the rest are dropped with a warning. */
  NOTIFY_MAX_RECIPIENTS: z.coerce.number().int().min(1).max(500).default(50),
  /** A burst in one chat pings a person at most once in this many seconds (the row still collapses and the badge still moves). */
  NOTIFY_THROTTLE_SECONDS: z.coerce.number().int().min(0).max(300).default(5),
});

export interface NotifyConfig {
  conversationsEnabled: boolean;
  maxRecipients: number;
  throttleSeconds: number;
}

/** Read at call time so tests can change the environment between runs. */
export function notifyConfig(env: NodeJS.ProcessEnv = process.env): NotifyConfig {
  const parsed = schema.parse(env);
  return {
    conversationsEnabled: parsed.NOTIFY_CONVERSATIONS_ENABLED ?? parsed.NODE_ENV !== 'production',
    maxRecipients: parsed.NOTIFY_MAX_RECIPIENTS,
    throttleSeconds: parsed.NOTIFY_THROTTLE_SECONDS,
  };
}
