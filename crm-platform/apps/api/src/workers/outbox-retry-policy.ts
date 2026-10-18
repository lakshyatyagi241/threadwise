/**
 * Retry policy for `event_outbox` rows (ASYNC-032/033/036/040).
 *
 * The delay is 2^attempts seconds capped at {@link OUTBOX_BACKOFF_CAP_SECONDS}, then "equal jitter": a random point in the upper
 * half of that delay, so a consumer that comes back after an outage does not get every waiting event in the same second. With 26
 * attempts the shortest possible window before an event is dead-lettered is about 2 hours (about 4 hours at the longest), enough to
 * ride out a provider or SMTP outage. The earlier 8 attempts gave up after about 4 minutes, which turned a short outage into
 * permanently lost billing charges and notifications.
 */
export const OUTBOX_MAX_ATTEMPTS = 26;
export const OUTBOX_BACKOFF_CAP_SECONDS = 900;

export interface OutboxRetryDecision {
  /** True when this failure was the last allowed attempt: the row goes to `dead` and needs a replay. */
  dead: boolean;
  backoffSeconds: number;
}

/** `attempts` is the number of attempts made so far, including the one that just failed. `random` returns [0, 1). */
export function outboxRetryDecision(
  attempts: number,
  random: () => number = Math.random,
): OutboxRetryDecision {
  const base = Math.min(2 ** attempts, OUTBOX_BACKOFF_CAP_SECONDS);
  const backoffSeconds = Math.floor(base * (0.5 + 0.5 * random()));
  return { dead: attempts >= OUTBOX_MAX_ATTEMPTS, backoffSeconds };
}
