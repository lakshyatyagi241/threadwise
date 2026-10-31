/**
 * One Idempotency-Key per checkout attempt (TW-STORE-012). A retry of the same payload reuses the key, so a response lost after the
 * order committed cannot place a second order. A changed payload gets a new key.
 */
export type CheckoutAttempt = { key: string; fingerprint: string };

export function checkoutAttempt(
  current: CheckoutAttempt | null,
  fingerprint: string,
  newKey: () => string,
): CheckoutAttempt {
  if (current && current.fingerprint === fingerprint) return current;
  return { key: newKey(), fingerprint };
}
