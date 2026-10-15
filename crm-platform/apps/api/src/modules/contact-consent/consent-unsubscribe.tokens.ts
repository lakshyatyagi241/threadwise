import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The email unsubscribe token (BL-141, RFC 8058). `<payload>.<signature>`: the payload is base64url of `1.<org id>.<contact id>`
 * (two numbers, no name, address or phone), the signature an HMAC-SHA256 of it. It does not expire (a mail can be opened years later and
 * an unsubscribe must still work) and it can do exactly one thing: withdraw that contact's email marketing.
 *
 * Keys: derived from the credentials key ring, so a rotation keeps old links valid (any key verifies, the first signs).
 */
const CONTEXT = 'consent-unsubscribe-v1';

const b64 = (b: Buffer): string => b.toString('base64url');

/** One signing key per ring key, derived so the raw credentials key is never used for two purposes. */
export function deriveUnsubscribeKeys(ringBase64: readonly string[]): Buffer[] {
  return ringBase64.map((k) =>
    createHmac('sha256', Buffer.from(k.trim(), 'base64')).update(CONTEXT).digest(),
  );
}

export function signUnsubscribeToken(
  keys: readonly Buffer[],
  orgId: number,
  contactId: number,
): string {
  const payload = b64(Buffer.from(`1.${orgId}.${contactId}`, 'utf8'));
  return `${payload}.${b64(createHmac('sha256', keys[0]!).update(payload).digest())}`;
}

export function verifyUnsubscribeToken(
  keys: readonly Buffer[],
  token: string,
): { orgId: number; contactId: number } | null {
  if (token.length > 200) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const given = Buffer.from(sig, 'base64url');
  const ok = keys.some((k) => {
    const want = createHmac('sha256', k).update(payload).digest();
    return want.length === given.length && timingSafeEqual(want, given);
  });
  if (!ok) return null;
  const m = /^1\.(\d{1,15})\.(\d{1,15})$/.exec(Buffer.from(payload, 'base64url').toString('utf8'));
  return m ? { orgId: Number(m[1]), contactId: Number(m[2]) } : null;
}

/** The two headers of RFC 8058 one-click unsubscribe. `postUrl` must be an https URL that accepts a POST. */
export function listUnsubscribeHeaders(postUrl: string, mailto?: string): Record<string, string> {
  return {
    'List-Unsubscribe': mailto ? `<${postUrl}>, <mailto:${mailto}>` : `<${postUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
