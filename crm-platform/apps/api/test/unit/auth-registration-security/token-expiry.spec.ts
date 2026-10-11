import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import { JWT_AUDIENCE, JWT_ISSUER, TokenService } from '../../../src/modules/auth/token.service';

const env: Record<string, string> = {
  JWT_ACCESS_SECRET: 'access-secret-for-tests-0123456789abcdef',
  JWT_REFRESH_SECRET: 'refresh-secret-for-tests-0123456789abcdef',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '30d',
};
const config = { get: (k: string) => env[k] } as never;
const jwt = new JwtService({});
const tokens = new TokenService(jwt, config);

describe('sign-out credentials (WD-AUTH-012)', () => {
  const claims = { sub: 1, org: 2, typ: 'user' as const, uid: 'u', sid: 'sess-1' };

  it('reads the session out of an access token that has just expired', async () => {
    const expired = await jwt.signAsync(claims, {
      secret: env.JWT_ACCESS_SECRET,
      expiresIn: -10,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    await expect(tokens.verifyAccess(expired)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(tokens.verifyAccessIgnoringExpiry(expired)).resolves.toMatchObject({
      sid: 'sess-1',
    });
  });

  it('still insists on the signature', async () => {
    const forged = await jwt.signAsync(claims, { secret: 'not-the-secret-not-the-secret-0000' });
    await expect(tokens.verifyAccessIgnoringExpiry(forged)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    // A refresh token is signed with the other key and is not an access token.
    const refresh = (await tokens.issue({ ...claims, rv: 1 })).refreshToken;
    await expect(tokens.verifyAccessIgnoringExpiry(refresh)).rejects.toBeTruthy();
  });
});
