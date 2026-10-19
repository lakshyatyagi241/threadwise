import { createHmac, timingSafeEqual } from 'node:crypto';
import { TELEPHONY_REPLAY_WINDOW_SECONDS } from '@crm/contracts';

/**
 * The signature of the generic callback: `v1=` + hex HMAC-SHA256, keyed with the connection's secret, over `<timestamp>.<raw body>`. The
 * timestamp is part of what is signed, so a captured callback cannot be replayed outside the window or with a new time.
 */
export function signTelephonyCallback(secret: string, timestamp: string, rawBody: Buffer): string {
  const mac = createHmac('sha256', secret)
    .update(`${timestamp}.`, 'utf8')
    .update(rawBody)
    .digest('hex');
  return `v1=${mac}`;
}

export function verifyTelephonyCallback(
  secret: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  rawBody: Buffer,
  now: Date = new Date(),
): boolean {
  if (!secret || !timestampHeader || !signatureHeader) return false;
  if (!/^\d{9,12}$/.test(timestampHeader.trim())) return false;
  const skew = Math.abs(now.getTime() / 1000 - Number(timestampHeader));
  if (!(skew <= TELEPHONY_REPLAY_WINDOW_SECONDS)) return false;
  const want = Buffer.from(signTelephonyCallback(secret, timestampHeader.trim(), rawBody));
  const got = Buffer.from(signatureHeader.trim());
  return want.length === got.length && timingSafeEqual(want, got);
}
