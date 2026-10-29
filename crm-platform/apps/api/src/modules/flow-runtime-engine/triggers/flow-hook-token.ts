import { createHmac, timingSafeEqual } from 'node:crypto';

const CONTEXT = 'flow-hook:v1:';

/**
 * The credential in a flow's webhook address: an HMAC of the flow's uuid under a server secret, so every flow has its own and nobody can
 * work one out from another, and nothing is stored (no column, no rotation table). It is shown to staff who may read the flow only.
 * 43 characters of base64url (256 bits).
 */
export function flowHookToken(secret: string, flowUuid: string): string {
  return createHmac('sha256', secret)
    .update(CONTEXT + flowUuid.toLowerCase())
    .digest('base64url');
}

/**
 * Whether `presented` is the token of this flow under any of the secrets (the current one first, then the retired ones still kept so a
 * key rotation does not break every address). Constant time: every secret is checked, and a token of the wrong length is compared
 * against a same-length dummy so the time does not tell a short guess from a long one.
 */
export function flowHookTokenMatches(
  secrets: readonly string[],
  flowUuid: string,
  presented: string,
): boolean {
  let ok = false;
  for (const secret of secrets) {
    const expected = Buffer.from(flowHookToken(secret, flowUuid));
    const given = Buffer.from(presented);
    const same = given.length === expected.length;
    const match = timingSafeEqual(same ? given : expected, expected);
    ok = (same && match) || ok;
  }
  return ok;
}
