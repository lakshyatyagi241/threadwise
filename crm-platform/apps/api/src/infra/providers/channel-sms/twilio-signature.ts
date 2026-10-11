import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Twilio's request signature (`X-Twilio-Signature`): base64 of HMAC-SHA1, keyed with the account's auth token, over the full public
 * URL Twilio was given followed by every POST field as name+value in name order. Compared in constant time; any doubt is false.
 */
export function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, unknown>,
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => {
      const v = params[k];
      // A repeated field arrives as an array: Twilio signs each value in turn.
      const parts = Array.isArray(v) ? v.map(String) : [String(v ?? '')];
      return acc + parts.map((p) => k + p).join('');
    }, url);
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, unknown>,
  header: string | undefined,
): boolean {
  if (!authToken || !header) return false;
  const want = Buffer.from(twilioSignature(authToken, url, params));
  const got = Buffer.from(header.trim());
  return want.length === got.length && timingSafeEqual(want, got);
}
