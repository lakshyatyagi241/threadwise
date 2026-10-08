import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import { IMPERSONATION_MAX_MINUTES } from '@crm/contracts';
import { TokenService } from '../../../src/modules/auth/token.service';

const env: Record<string, string> = {
  JWT_ACCESS_SECRET: 'access-secret-for-tests-0123456789abcdef',
  JWT_REFRESH_SECRET: 'refresh-secret-for-tests-0123456789abcdef',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '30d',
};
const jwt = new JwtService({});
const tokens = new TokenService(jwt, { get: (k: string) => env[k] } as never);

const claims = {
  sub: 5,
  org: 7,
  typ: 'user' as const,
  uid: 'owner-uuid',
  sid: 'imp-session',
  ep: 0,
  imp: { sid: 'imp-session', oid: 9, ro: true, exp: Math.floor(Date.now() / 1000) + 600 },
};

describe('act-as token (TW-WSP-032)', () => {
  it('carries the imp claim through verification and has no refresh counterpart', async () => {
    const issued = await tokens.issueImpersonation(claims, 600);
    expect(Object.keys(issued).sort()).toEqual(['accessToken', 'expiresIn']);
    const back = await tokens.verifyAccess(issued.accessToken);
    expect(back).toMatchObject({
      sub: 5,
      org: 7,
      typ: 'user',
      imp: { sid: 'imp-session', oid: 9, ro: true },
    });
    // signed with the access secret only: it cannot be presented as a refresh token
    await expect(tokens.verifyRefresh(issued.accessToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('lives exactly as long as asked, not as long as a normal access token, and never past the maximum', async () => {
    const short = await tokens.issueImpersonation(claims, 120);
    const decodedShort = jwt.decode(short.accessToken) as { iat: number; exp: number };
    expect(decodedShort.exp - decodedShort.iat).toBe(120);

    const long = await tokens.issueImpersonation(claims, 45 * 60);
    expect(long.expiresIn).toBe(45 * 60); // beyond the 15 minute access TTL: nothing refreshes it

    const capped = await tokens.issueImpersonation(claims, 24 * 3600);
    expect(capped.expiresIn).toBe(IMPERSONATION_MAX_MINUTES * 60);
  });

  it('refuses a token whose time has run out, and one signed with the wrong key', async () => {
    const forged = await jwt.signAsync(claims, {
      secret: 'not-the-secret-not-the-secret-0000',
      expiresIn: 60,
    });
    await expect(tokens.verifyAccess(forged)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const expired = await jwt.signAsync(claims, { secret: env.JWT_ACCESS_SECRET, expiresIn: -5 });
    await expect(tokens.verifyAccess(expired)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('ordinary tokens never carry an imp claim', async () => {
    const pair = await tokens.issue({ sub: 1, org: 1, typ: 'user', uid: 'u', sid: 's' });
    expect((await tokens.verifyAccess(pair.accessToken)).imp).toBeUndefined();
  });
});
