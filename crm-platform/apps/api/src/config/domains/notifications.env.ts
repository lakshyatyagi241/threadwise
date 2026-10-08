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
  /**
   * The "waiting for a reply" nudge (BL-098). An unassigned, open chat whose latest customer message has gone unanswered this many
   * minutes tells the people who may reply, once per waiting episode. A workspace setting for it was left out on purpose: one default for
   * everyone is enough until an owner asks, and a per-workspace value would put a settings join into the sweep.
   */
  NOTIFY_WAITING_MINUTES: z.coerce.number().int().min(1).max(1440).default(5),
  /** Off switch of the nudge alone (the conversation notifications switch above must also be on). */
  NOTIFY_WAITING_ENABLED: booleanish.default(true),
  /** A chat whose latest message is older than this many hours is not nudged: switching the feature on must not wake up an old backlog. */
  NOTIFY_WAITING_LOOKBACK_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  /** The most chats one sweep handles (the sweep runs every minute; the rest are picked up by the next one). */
  NOTIFY_WAITING_BATCH: z.coerce.number().int().min(1).max(1000).default(100),
  /** Retention (decision D5): the daily prune of the bell feed. Off switch for an environment that wants to keep everything. */
  NOTIFY_RETENTION_ENABLED: booleanish.default(true),
  /** Rows already read are deleted once they are older than this many days. Never below 30. */
  NOTIFY_RETENTION_READ_DAYS: z.coerce.number().int().min(30).max(3650).default(90),
  /** Rows still unread are deleted once they are older than this many days. Raised to the read age if set lower. */
  NOTIFY_RETENTION_UNREAD_DAYS: z.coerce.number().int().min(30).max(3650).default(180),
  /** Rows deleted per statement (each batch is its own short transaction). */
  NOTIFY_RETENTION_BATCH_SIZE: z.coerce.number().int().min(100).max(50_000).default(5_000),
  /** Statements per run and per kind of row, so one pass is bounded; the next day continues where this one stopped. */
  NOTIFY_RETENTION_MAX_BATCHES: z.coerce.number().int().min(1).max(10_000).default(200),
});

export interface NotifyConfig {
  conversationsEnabled: boolean;
  maxRecipients: number;
  throttleSeconds: number;
}

export interface WaitingConfig {
  enabled: boolean;
  minutes: number;
  lookbackHours: number;
  batch: number;
}

export interface RetentionConfig {
  enabled: boolean;
  readDays: number;
  unreadDays: number;
  batchSize: number;
  maxBatches: number;
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

/** The retention job's settings. An unread age below the read age is raised to it, so an unread row is never pruned before a read one. */
export function retentionConfig(env: NodeJS.ProcessEnv = process.env): RetentionConfig {
  const parsed = schema.parse(env);
  return {
    enabled: parsed.NOTIFY_RETENTION_ENABLED,
    readDays: parsed.NOTIFY_RETENTION_READ_DAYS,
    unreadDays: Math.max(parsed.NOTIFY_RETENTION_UNREAD_DAYS, parsed.NOTIFY_RETENTION_READ_DAYS),
    batchSize: parsed.NOTIFY_RETENTION_BATCH_SIZE,
    maxBatches: parsed.NOTIFY_RETENTION_MAX_BATCHES,
  };
}

/** The waiting-for-a-reply sweep's settings. It needs the conversation notifications to be on as well. */
export function waitingConfig(env: NodeJS.ProcessEnv = process.env): WaitingConfig {
  const parsed = schema.parse(env);
  return {
    enabled: notifyConfig(env).conversationsEnabled && parsed.NOTIFY_WAITING_ENABLED,
    minutes: parsed.NOTIFY_WAITING_MINUTES,
    // Never shorter than the wait itself, or no chat could ever qualify.
    lookbackHours: Math.max(
      parsed.NOTIFY_WAITING_LOOKBACK_HOURS,
      Math.ceil(parsed.NOTIFY_WAITING_MINUTES / 60),
    ),
    batch: parsed.NOTIFY_WAITING_BATCH,
  };
}
