import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { WhatsAppWebhookScheme } from './whatsapp-provider.resolver';

/**
 * Meta signs the RAW body of every webhook delivery with the app secret: `X-Hub-Signature-256: sha256=<hex>`.
 *
 * Two things this gets right that naive versions get wrong: it hashes the raw bytes (a parsed and re-serialised body has different
 * key order and whitespace, so a different digest), and it compares in constant time, so the comparison cannot be used as an oracle
 * to guess the signature byte by byte. It returns false on any doubt: no secret, no header, a header that is not `sha256=` plus
 * exactly 64 hex characters.
 */
export function verifyMetaSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!appSecret || !signatureHeader) return false;
  const match = /^sha256=([0-9a-fA-F]{64})$/.exec(signatureHeader.trim());
  if (!match) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const received = Buffer.from(match[1]!, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

const sha = (s: string): Buffer => createHash('sha256').update(s).digest();

/**
 * Whether a delivery proves it came from the provider, by the scheme the provider's profile names. Fails closed: no secret, no
 * header, or an unknown scheme is false. `secret` is the one to check with (the caller picks the channel's own or the provider's).
 *
 *   meta_app_secret_sha256  `X-Hub-Signature-256` over the raw body.
 *   shared_secret_header    the header `headerName` carries the secret itself; compared in constant time.
 */
export function verifyDelivery(
  scheme: WhatsAppWebhookScheme['signatureScheme'],
  secret: string | null | undefined,
  headerName: string | undefined,
  rawBody: Buffer,
  headers: Readonly<Record<string, string | undefined>>,
): boolean {
  if (!secret) return false;
  if (scheme === 'meta_app_secret_sha256') return verifyMetaSignature(rawBody, headers['x-hub-signature-256'], secret);
  if (scheme === 'shared_secret_header') {
    const presented = headerName ? headers[headerName.toLowerCase()] : undefined;
    if (!presented) return false;
    // Hashing first makes the two buffers the same length, so the comparison needs no early length check that would leak it.
    return timingSafeEqual(sha(presented), sha(secret));
  }
  return false;
}
