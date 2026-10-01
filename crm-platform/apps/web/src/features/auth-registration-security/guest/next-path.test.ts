import { describe, expect, it } from 'vitest';
import { postLoginTarget, safeNextPath } from './next-path';

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
