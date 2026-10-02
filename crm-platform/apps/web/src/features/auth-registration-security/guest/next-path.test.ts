import { describe, expect, it } from 'vitest';
import { loginPath, postLoginTarget, refreshPath, safeNextPath } from './next-path';

describe('safeNextPath', () => {
  it('accepts same-site relative paths with query and hash', () => {
    expect(safeNextPath('/inbox')).toBe('/inbox');
    expect(safeNextPath('/contacts?tag=vip&page=2#top')).toBe('/contacts?tag=vip&page=2#top');
    expect(safeNextPath('  /dashboard ')).toBe('/dashboard');
  });

  it('rejects anything that could leave the site', () => {
    for (const bad of [
      '//evil.example',
      '///evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      '%2F%2Fevil.example',
      'inbox',
      '',
      '/%2F%2Fevil.example',
      '/%5Cevil.example/../..//x',
    ]) {
      expect(safeNextPath(bad), bad).toBeNull();
    }
  });

  it('rejects control characters and absurd lengths', () => {
    expect(safeNextPath('/inbox\r\nSet-Cookie: a=b')).toBeNull();
    expect(safeNextPath('/inbox\u0000')).toBeNull();
    expect(safeNextPath(`/${'a'.repeat(3000)}`)).toBeNull();
  });

  it('rejects raw API paths and guest pages that would loop', () => {
    expect(safeNextPath('/api/auth/logout')).toBeNull();
    expect(safeNextPath('/logout')).toBeNull();
    expect(safeNextPath('/register')).toBeNull();
    expect(safeNextPath('/login')).toBeNull();
    expect(safeNextPath('/login?next=/inbox')).toBeNull();
    expect(safeNextPath('/signup')).toBeNull();
    expect(safeNextPath('/reset-password?org=a&token=b')).toBeNull();
    expect(safeNextPath('/loginhelp')).toBe('/loginhelp');
  });

  it('handles missing values', () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });
});

describe('postLoginTarget', () => {
  it('goes to the home router when there is no safe return path', () => {
    expect(postLoginTarget(null)).toBe('/');
    expect(postLoginTarget('//evil.example')).toBe('/');
  });
  it('honours a safe return path', () => {
    expect(postLoginTarget('/contacts')).toBe('/contacts');
  });
});

describe('loginPath: where a signed-out visitor is sent (WD-AUTH-001/011)', () => {
  it('carries the page they asked for, query included, as ?next=', () => {
    expect(loginPath('/contacts?tag=vip')).toBe('/login?next=%2Fcontacts%3Ftag%3Dvip');
    expect(loginPath('/account/security')).toBe('/login?next=%2Faccount%2Fsecurity');
  });

  it('says the session ended for inactivity, with the limit, next to the return path', () => {
    expect(loginPath('/contacts', { idleMinutes: 30 })).toBe(
      '/login?expired=idle&minutes=30&next=%2Fcontacts',
    );
    expect(loginPath(null, { idleMinutes: 5 })).toBe('/login?expired=idle&minutes=5');
    // An unusable limit falls back to the plain expired notice.
    expect(loginPath(null, { expired: true, idleMinutes: 0 })).toBe('/login?expired=1');
  });

  it('goes to plain sign-in when there is nothing worth returning to', () => {
    expect(loginPath(null)).toBe('/login');
    expect(loginPath('/')).toBe('/login');
    expect(loginPath('/login?next=/inbox')).toBe('/login');
    expect(loginPath('//evil.example')).toBe('/login');
    expect(loginPath('/api/v2/contacts')).toBe('/login');
  });

  it('marks a lapsed session and still keeps the page', () => {
    expect(loginPath('/inbox', { expired: true })).toBe('/login?expired=1&next=%2Finbox');
    expect(loginPath(null, { expired: true })).toBe('/login?expired=1');
  });

  it('round-trips through the sign-in page: the value the form reads back is the page asked for', () => {
    const url = new URL(loginPath('/contacts?tag=vip&page=2#top'), 'http://x.test');
    expect(safeNextPath(url.searchParams.get('next'))).toBe('/contacts?tag=vip&page=2#top');
  });
});

describe('refreshPath: a lapsed access token with a live refresh token', () => {
  it('rotates the session and then returns to the page that was asked for', () => {
    expect(refreshPath('/contacts?tag=vip')).toBe('/api/auth/refresh?next=%2Fcontacts%3Ftag%3Dvip');
  });
  it('falls back to the home router', () => {
    expect(refreshPath(null)).toBe('/api/auth/refresh?next=/');
    expect(refreshPath('/')).toBe('/api/auth/refresh?next=/');
    expect(refreshPath('/login')).toBe('/api/auth/refresh?next=/');
  });
});
