import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { config, proxy } from './proxy';
import { REQUEST_PATH_HEADER } from '@/lib/auth/next-path';

const get = (url: string, headers: Record<string, string> = {}) =>
  proxy(new NextRequest(`http://localhost:3001${url}`, { headers }));

function requestHeader(res: Response, name: string): string | null {
  // NextResponse.next({ request: { headers } }) publishes the new request headers as x-middleware-request-*.
  return res.headers.get(`x-middleware-request-${name}`);
}

describe('proxy: referral cookie (TW-AUTH-005)', () => {
  it('stores a ?ref= on any page as an httpOnly, lax, 30-day cookie', () => {
    const res = get('/signup?ref=got123');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('crm_ref=GOT123');
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('samesite=lax');
    expect(cookie).toContain(`Max-Age=${60 * 60 * 24 * 30}`);
    expect(cookie).toContain('Path=/');
  });

  it('turns /pricing?ref=abcd-1234 into crm_ref=ABCD1234 (TW-CPN-030)', () => {
    const cookie = get('/pricing?ref=abcd-1234').headers.get('set-cookie') ?? '';
    expect(cookie).toContain('crm_ref=ABCD1234');
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('samesite=lax');
  });

  it('replaces the stored code when a later visit carries a different one (last touch wins)', () => {
    const res = get('/pricing?ref=second2', { cookie: 'crm_ref=FIRST1' });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('crm_ref=SECOND2');
    expect(cookie).not.toContain('FIRST1');
  });

  it('keeps the stored code when a later visit carries none or an unusable one', () => {
    expect(get('/pricing', { cookie: 'crm_ref=FIRST1' }).headers.get('set-cookie')).toBeNull();
    expect(
      get('/pricing?ref=***', { cookie: 'crm_ref=FIRST1' }).headers.get('set-cookie'),
    ).toBeNull();
  });

  it('works on a page other than sign-up (the visitor may click around first)', () => {
    expect(get('/login?ref=AB12')?.headers.get('set-cookie')).toContain('crm_ref=AB12');
    expect(get('/forgot-password?ref=zz9')?.headers.get('set-cookie')).toContain('crm_ref=ZZ9');
  });

  it('cleans the code to A-Z0-9', () => {
    expect(get('/signup?ref=a-b%20c%3Cd%3E')?.headers.get('set-cookie')).toContain('crm_ref=ABCD');
  });

  it('drops a code that is empty or longer than 16 instead of shortening it', () => {
    expect(get('/signup?ref=')?.headers.get('set-cookie')).toBeNull();
    expect(get('/signup?ref=!!!')?.headers.get('set-cookie')).toBeNull();
    expect(get(`/signup?ref=${'A'.repeat(17)}`)?.headers.get('set-cookie')).toBeNull();
    expect(get(`/signup?ref=${'A'.repeat(16)}`)?.headers.get('set-cookie')).toContain(
      `crm_ref=${'A'.repeat(16)}`,
    );
  });

  it('sets no cookie when there is no ?ref=, and marks it Secure behind an https edge', () => {
    expect(get('/login')?.headers.get('set-cookie')).toBeNull();
    const secure = get('/signup?ref=ABC', { 'x-forwarded-proto': 'https' });
    expect(secure.headers.get('set-cookie')).toContain('Secure');
  });
});

describe('proxy: request path header (carries ?next= to server layouts)', () => {
  it('records the path and query of the page that was asked for', () => {
    expect(requestHeader(get('/contacts?tag=vip'), REQUEST_PATH_HEADER)).toBe('/contacts?tag=vip');
  });

  it('overwrites a value sent by the browser', () => {
    const res = get('/contacts', { [REQUEST_PATH_HEADER]: '/evil' });
    expect(requestHeader(res, REQUEST_PATH_HEADER)).toBe('/contacts');
  });
});

describe('proxy matcher', () => {
  it('covers pages but not API routes, Next internals or files', () => {
    const re = new RegExp(`^${config.matcher[0]!}$`);
    for (const path of ['/login', '/signup', '/contacts', '/account/security', '/']) {
      expect(re.test(path), path).toBe(true);
    }
    for (const path of ['/api/auth/login', '/_next/static/x.js', '/favicon.ico', '/icon.svg']) {
      expect(re.test(path), path).toBe(false);
    }
  });
});
