import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import {
  assertTokenClaims,
  JWT_AUDIENCE,
  JWT_ISSUER,
  LEGACY_TOKENS_UNTIL_MS,
  TokenService,
} from '../../../src/modules/auth/token.service';

const ACCESS = 'access-secret-for-tests-0123456789abcdef';
const REFRESH = 'refresh-secret-for-tests-0123456789abcdef';
const OLD_ACCESS = 'retired-access-secret-0123456789abcdefgh';
const base: Record<string, string> = {
  JWT_ACCESS_SECRET: ACCESS,
  JWT_REFRESH_SECRET: REFRESH,
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '30d',
};
const make = (extra: Record<string, string> = {}) => {
  const env = { ...base, ...extra };
  return new TokenService(new JwtService({}), { get: (k: string) => env[k] } as never);
};
const jwtSvc = new JwtService({});
const sign = (payload: object, secret: string, opts: JwtSignOptions = {}) =>
  jwtSvc.sign(payload, { secret, expiresIn: 600, ...opts });
const claims = { sub: 1, org: 2, typ: 'user' as const, uid: 'u', sid: 'sess-1' };
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('tokens we mint', () => {
  it('carry the algorithm, issuer and audience', async () => {
    const pair = await make().issue(claims);
    for (const t of [pair.accessToken, pair.refreshToken]) {
      const decoded = jwtSvc.decode(t, { complete: true }) as {
        header: { alg: string };
        payload: { iss: string; aud: string };
      };
      expect(decoded.header.alg).toBe('HS256');
      expect(decoded.payload.iss).toBe(JWT_ISSUER);
      expect(decoded.payload.aud).toBe(JWT_AUDIENCE);
    }
  });

  it('round-trip through verifyAccess / verifyRefresh', async () => {
    const svc = make();
    const pair = await svc.issue({ ...claims, rv: 1 });
    await expect(svc.verifyAccess(pair.accessToken)).resolves.toMatchObject({ sid: 'sess-1' });
    await expect(svc.verifyRefresh(pair.refreshToken)).resolves.toMatchObject({ rv: 1 });
  });
});

describe('tokens we refuse', () => {
  const svc = make();
  const signed = (opts: JwtSignOptions, secret = ACCESS, payload: object = claims) =>
    sign(payload, secret, opts);

  it('alg=none and algorithms other than HS256', async () => {
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims, iss: JWT_ISSUER, aud: JWT_AUDIENCE, exp: 4102444800 })}.`;
    await expect(svc.verifyAccess(none)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    for (const algorithm of ['HS384', 'HS512'] as const) {
      const t = signed({ algorithm, issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
      await expect(svc.verifyAccess(t)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });

  it('a wrong issuer or a wrong audience', async () => {
    await expect(
      svc.verifyAccess(signed({ issuer: 'someone-else', audience: JWT_AUDIENCE })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      svc.verifyAccess(signed({ issuer: JWT_ISSUER, audience: 'another-api' })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('not-yet-valid, expired and wrong-key tokens', async () => {
    const ok = { issuer: JWT_ISSUER, audience: JWT_AUDIENCE };
    await expect(
      svc.verifyAccess(signed({ ...ok, notBefore: 3600, expiresIn: 7200 })),
    ).rejects.toBeTruthy();
    await expect(svc.verifyAccess(signed({ ...ok, expiresIn: -5 }))).rejects.toBeTruthy();
    await expect(svc.verifyAccess(signed(ok, 'x'.repeat(40)))).rejects.toBeTruthy();
  });

  it('an access token presented as a refresh token, and the reverse', async () => {
    const pair = await svc.issue({ ...claims, rv: 1 });
    await expect(svc.verifyRefresh(pair.accessToken)).rejects.toBeTruthy();
    await expect(svc.verifyAccess(pair.refreshToken)).rejects.toBeTruthy();
  });
});

describe('claims written before issuer/audience existed', () => {
  it('are accepted only until the transition date', () => {
    const legacy = { ...claims };
    expect(() => assertTokenClaims(legacy as never, LEGACY_TOKENS_UNTIL_MS - 1)).not.toThrow();
    expect(() => assertTokenClaims(legacy as never, LEGACY_TOKENS_UNTIL_MS)).toThrow();
  });

  it('are verified end to end while the window is open', async () => {
    const svc = make();
    const legacyToken = sign(claims, ACCESS);
    if (Date.now() < LEGACY_TOKENS_UNTIL_MS) {
      await expect(svc.verifyAccess(legacyToken)).resolves.toMatchObject({ sid: 'sess-1' });
    } else {
      await expect(svc.verifyAccess(legacyToken)).rejects.toBeTruthy();
    }
  });

  it('still refuse a half-claimed token (issuer without audience)', () => {
    expect(() => assertTokenClaims({ ...claims, iss: JWT_ISSUER } as never, 0)).toThrow();
  });
});

describe('secret rotation', () => {
  it('signs with the current secret only, but still verifies tokens signed with a retired one', async () => {
    const retired = make({ JWT_ACCESS_SECRET: OLD_ACCESS });
    const oldToken = (await retired.issue(claims)).accessToken;

    const rotated = make({
      JWT_ACCESS_SECRET: ACCESS,
      JWT_ACCESS_PREVIOUS_SECRETS: `${OLD_ACCESS}, short`,
    });
    await expect(rotated.verifyAccess(oldToken)).resolves.toMatchObject({ sid: 'sess-1' });

    const fresh = (await rotated.issue(claims)).accessToken;
    await expect(make({ JWT_ACCESS_SECRET: OLD_ACCESS }).verifyAccess(fresh)).rejects.toBeTruthy();
    await expect(rotated.verifyAccess(fresh)).resolves.toMatchObject({ sid: 'sess-1' });
  });

  it('stops accepting a secret once it is removed from the list', async () => {
    const oldToken = (await make({ JWT_ACCESS_SECRET: OLD_ACCESS }).issue(claims)).accessToken;
    await expect(make().verifyAccess(oldToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('ignores retired secrets that are too short to be real', async () => {
    const weak = 'short';
    const token = sign(claims, weak, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    await expect(
      make({ JWT_ACCESS_PREVIOUS_SECRETS: weak }).verifyAccess(token),
    ).rejects.toBeTruthy();
  });

  it('applies to refresh tokens too', async () => {
    const oldRefresh = (
      await make({ JWT_REFRESH_SECRET: 'retired-refresh-secret-0123456789abcdefg' }).issue({
        ...claims,
        rv: 1,
      })
    ).refreshToken;
    const rotated = make({
      JWT_REFRESH_PREVIOUS_SECRETS: 'retired-refresh-secret-0123456789abcdefg',
    });
    await expect(rotated.verifyRefresh(oldRefresh)).resolves.toMatchObject({ rv: 1 });
  });
});
