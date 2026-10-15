import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCESS_COOKIE,
  OP_ACCESS_COOKIE,
  OP_REFRESH_COOKIE,
  REFRESH_COOKIE,
  REMEMBER_COOKIE,
  clearSessionCookies,
  setImpersonationCookie,
  setSessionCookies,
} from './cookies';

type Opts = Record<string, unknown>;
function jar() {
  const set = new Map<string, { value: string; opts: Opts }>();
  const deleted: string[] = [];
  return {
    set,
    deleted,
    store: {
      set: (n: string, v: string, o: Opts) => set.set(n, { value: v, opts: o }),
      delete: (n: string) => deleted.push(n),
    },
  };
}
const pair = { accessToken: 'a.b.c', refreshToken: 'd.e.f', expiresIn: 900 };

afterEach(() => vi.unstubAllEnvs());

describe('session cookies (session/token security)', () => {
  it.each(['user', 'operator'] as const)(
    'every %s token cookie is httpOnly, SameSite=Lax, site-wide, and Secure in production',
    (kind) => {
      vi.stubEnv('NODE_ENV', 'production');
      const j = jar();
      setSessionCookies(j.store, pair, { kind, remember: true });
      expect(j.set.size).toBeGreaterThanOrEqual(2);
      for (const [name, { opts }] of j.set) {
        expect(opts, name).toMatchObject({
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
          path: '/',
        });
      }
    },
  );

  it('does not mark cookies Secure outside production (plain http on a developer machine)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const j = jar();
    setSessionCookies(j.store, pair);
    expect(j.set.get(ACCESS_COOKIE)!.opts.secure).toBe(false);
  });

  it('the access cookie lives exactly as long as the access token', () => {
    const j = jar();
    setSessionCookies(j.store, pair);
    expect(j.set.get(ACCESS_COOKIE)!.opts.maxAge).toBe(900);
  });

  it('without "keep me signed in" the refresh cookie ends with the browser session', () => {
    const j = jar();
    setSessionCookies(j.store, pair, { remember: false });
    expect(j.set.get(REFRESH_COOKIE)!.opts).not.toHaveProperty('maxAge');
    expect(j.set.get(REMEMBER_COOKIE)!.value).toBe('0');
  });

  it('with "keep me signed in" the refresh cookie lasts 30 days, never longer', () => {
    const j = jar();
    setSessionCookies(j.store, pair, { remember: true });
    expect(j.set.get(REFRESH_COOKIE)!.opts.maxAge).toBe(60 * 60 * 24 * 30);
  });

  it('a platform operator gets a separate cookie set, a 12 hour refresh and no remember cookie', () => {
    const j = jar();
    setSessionCookies(j.store, pair, { kind: 'operator', remember: true });
    expect([...j.set.keys()].sort()).toEqual([OP_ACCESS_COOKIE, OP_REFRESH_COOKIE].sort());
    expect(j.set.get(OP_REFRESH_COOKIE)!.opts.maxAge).toBe(60 * 60 * 12);
    expect(j.set.has(ACCESS_COOKIE)).toBe(false);
  });

  it('an impersonation session sets only an access cookie, so nothing in the browser can renew it', () => {
    const j = jar();
    setImpersonationCookie(j.store, 'imp.token.x', 600);
    expect([...j.set.keys()]).toEqual([ACCESS_COOKIE]);
    expect(j.set.get(ACCESS_COOKIE)!.opts).toMatchObject({ httpOnly: true, maxAge: 600 });
  });

  it('sign-out clears every cookie of the pool it ends, and none of the other pool', () => {
    const u = jar();
    clearSessionCookies(u.store, 'user');
    expect(u.deleted.sort()).toEqual([ACCESS_COOKIE, REFRESH_COOKIE, REMEMBER_COOKIE].sort());
    const o = jar();
    clearSessionCookies(o.store, 'operator');
    expect(o.deleted.sort()).toEqual([OP_ACCESS_COOKIE, OP_REFRESH_COOKIE].sort());
  });
});
