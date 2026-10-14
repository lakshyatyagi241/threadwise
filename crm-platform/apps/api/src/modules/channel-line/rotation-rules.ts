import { createSign } from 'node:crypto';

/** Pure rules of token rotation: the signed assertion LINE trades for a v2.1 channel access token, and when to renew. */

const b64url = (data: Buffer | string): string =>
  Buffer.from(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** LINE's ceiling for an issued token's life: 30 days, in seconds. */
export const MAX_TOKEN_SECONDS = 2_592_000;
/** An assertion may live at most 30 minutes. */
const ASSERTION_SECONDS = 1800;
/** A rotated token is renewed once it has less than this left (Reference: a day). */
const RENEW_WITHIN_MS = 24 * 3_600_000;

/**
 * The RS256 JWT assertion for LINE's v2.1 token endpoint: header {alg, typ, kid}, claims iss and sub = the numeric Channel ID, aud =
 * https://api.line.me/, exp = now + 30 min, token_exp = the life asked for (60 s to 30 days). Signed with the Assertion Signing Key
 * registered in the LINE console. Returns '' when the key cannot sign.
 */
export function buildAssertionJwt(input: {
  channelId: string;
  kid: string;
  privateKeyPem: string;
  tokenSeconds?: number;
  nowSeconds?: number;
}): string {
  try {
    const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
    const tokenExp = Math.min(
      Math.max(input.tokenSeconds ?? MAX_TOKEN_SECONDS, 60),
      MAX_TOKEN_SECONDS,
    );
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: input.kid }));
    const claims = b64url(
      JSON.stringify({
        iss: input.channelId,
        sub: input.channelId,
        aud: 'https://api.line.me/',
        exp: now + ASSERTION_SECONDS,
        token_exp: tokenExp,
      }),
    );
    const signingInput = `${header}.${claims}`;
    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    return `${signingInput}.${b64url(signer.sign(input.privateKeyPem))}`;
  } catch {
    return '';
  }
}

/** A cached rotated token is used while it has more than a day left; otherwise a new one is minted. */
export function rotatedTokenIsFresh(
  token: string | null,
  expiresAt: Date | null,
  now: Date,
): boolean {
  return (
    Boolean(token) && expiresAt !== null && expiresAt.getTime() - now.getTime() > RENEW_WITHIN_MS
  );
}

/** Whether a channel is set up for rotation: both the key id and the private key are saved. */
export const rotationConfigured = (kid: string | null, key: string | null): boolean =>
  (kid ?? '').trim() !== '' && (key ?? '').trim() !== '';
