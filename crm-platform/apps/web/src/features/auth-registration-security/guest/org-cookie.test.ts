import { describe, expect, it } from 'vitest';
import { orgCookie } from './org-cookie';

describe('orgCookie', () => {
  it('writes a one-year lax cookie for a valid slug', () => {
    const c = orgCookie('guestqa-one');
    expect(c).toContain('crm_org=guestqa-one');
    expect(c).toContain(`Max-Age=${60 * 60 * 24 * 365}`);
    expect(c).toContain('Path=/');
    expect(c).toContain('SameSite=Lax');
  });

  it('refuses anything that is not a workspace slug (no cookie injection)', () => {
    for (const bad of [
      null,
      undefined,
      '',
      'a',
      '-x',
      'has space',
      'a;b=c',
      'x'.repeat(41),
      'ünï',
    ]) {
      expect(orgCookie(bad as string | undefined), String(bad)).toBeNull();
    }
  });
});
