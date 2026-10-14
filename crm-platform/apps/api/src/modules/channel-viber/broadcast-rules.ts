import type { ViberBroadcastData } from '../../infra/providers/channel-viber/viber.port';
import { VIBER_BROADCAST_MAX } from '../../infra/providers/channel-viber/viber.port';

/** Pure rules of a Viber broadcast (TW-VIB-012, 013). */

/** Users sent to in one `broadcast_message` call: Viber's own per-call cap. */
export const BATCH_SIZE = VIBER_BROADCAST_MAX;
/** A pause between two calls, so a long broadcast stays well under Viber's rate limits. */
export const BATCH_GAP_MS = 500;
/** A recipient claimed by a worker that died is put back after this long. */
export const CLAIM_TIMEOUT_MINUTES = 2;
/** Reference listed the 1000 newest threads of a channel. */
export const AUDIENCE_LIMIT = 1000;

/** Whole percent done: sent and failed both count (Reference). */
export const progressPct = (sent: number, failed: number, total: number): number =>
  Math.round(((sent + failed) / Math.max(1, total)) * 100);

export interface BatchOutcome {
  /** Users Viber accepted. */
  sent: string[];
  /** Users Viber named in `failed_list`, with its reason. */
  failed: Map<string, string>;
}

/** Viber's reason for a user it refused when it gives none. */
export const FAILED_FALLBACK = 'failed';

/**
 * One `broadcast_message` answer, read per user (Reference's rule): everyone named in `failed_list` failed with Viber's
 * `status_message`, everyone else was sent.
 */
export function readBatch(
  userIds: readonly string[],
  data: ViberBroadcastData | undefined,
): BatchOutcome {
  const failed = new Map<string, string>();
  for (const f of data?.failed_list ?? []) {
    const id = f?.receiver;
    if (typeof id === 'string' && id !== '') failed.set(id, f.status_message || FAILED_FALLBACK);
  }
  return { sent: userIds.filter((id) => !failed.has(id)), failed };
}
