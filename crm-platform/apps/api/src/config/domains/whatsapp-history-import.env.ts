import { z } from 'zod';

/**
 * Limits of the opt-in history import of a personal WhatsApp number (TW-WAHIST, docs/specs/personal-whatsapp-connect.md section 14).
 * Read from the environment at call time (a change applies to the next run without a restart; a run keeps the caps it was requested
 * with). Every value has a safe default and a hard ceiling, so a typo cannot turn the import into an unbounded copy.
 */
const schema = z.object({
  /** How far back a `recent` import keeps messages. */
  WA_HISTORY_IMPORT_RECENT_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  /** How far back a `full` import keeps messages. */
  WA_HISTORY_IMPORT_FULL_DAYS: z.coerce.number().int().min(1).max(3650).default(730),
  /** Most messages one import stores for one number. */
  WA_HISTORY_IMPORT_MAX_MESSAGES: z.coerce.number().int().min(100).max(1_000_000).default(50_000),
  /** Most messages one import stores for one chat (the newest of what WhatsApp sent are kept first). */
  WA_HISTORY_IMPORT_MAX_MESSAGES_PER_CHAT: z.coerce.number().int().min(1).max(100_000).default(500),
  /** Most chats (people and groups) one import brings in. */
  WA_HISTORY_IMPORT_MAX_CHATS: z.coerce.number().int().min(1).max(100_000).default(5_000),
  /** Messages per batch handed from the socket to the importer. */
  WA_HISTORY_IMPORT_BATCH_SIZE: z.coerce.number().int().min(10).max(1_000).default(200),
  /** A running import that gets nothing for this long is finished. */
  WA_HISTORY_IMPORT_IDLE_FINISH_SECONDS: z.coerce.number().int().min(30).max(3_600).default(180),
  /** The same for a `full` import: WhatsApp's older chunks can come minutes apart, so the window is longer. */
  WA_HISTORY_IMPORT_FULL_IDLE_FINISH_SECONDS: z.coerce
    .number()
    .int()
    .min(30)
    .max(7_200)
    .default(600),
  /** An import that was asked for but whose history never arrived (not linked, or WhatsApp sent none) is given up after this long. */
  WA_HISTORY_IMPORT_AWAIT_MINUTES: z.coerce.number().int().min(5).max(1_440).default(30),
});

export interface HistoryImportConfig {
  recentDays: number;
  fullDays: number;
  maxMessages: number;
  maxMessagesPerChat: number;
  maxChats: number;
  batchSize: number;
  idleFinishSeconds: number;
  fullIdleFinishSeconds: number;
  awaitMinutes: number;
}

export function historyImportConfig(env: NodeJS.ProcessEnv = process.env): HistoryImportConfig {
  const p = schema.parse(env);
  return {
    recentDays: p.WA_HISTORY_IMPORT_RECENT_DAYS,
    fullDays: p.WA_HISTORY_IMPORT_FULL_DAYS,
    maxMessages: p.WA_HISTORY_IMPORT_MAX_MESSAGES,
    maxMessagesPerChat: p.WA_HISTORY_IMPORT_MAX_MESSAGES_PER_CHAT,
    maxChats: p.WA_HISTORY_IMPORT_MAX_CHATS,
    batchSize: p.WA_HISTORY_IMPORT_BATCH_SIZE,
    idleFinishSeconds: p.WA_HISTORY_IMPORT_IDLE_FINISH_SECONDS,
    fullIdleFinishSeconds: p.WA_HISTORY_IMPORT_FULL_IDLE_FINISH_SECONDS,
    awaitMinutes: p.WA_HISTORY_IMPORT_AWAIT_MINUTES,
  };
}

export const windowDaysOf = (
  mode: 'recent' | 'full',
  c: HistoryImportConfig = historyImportConfig(),
): number => (mode === 'recent' ? c.recentDays : c.fullDays);
