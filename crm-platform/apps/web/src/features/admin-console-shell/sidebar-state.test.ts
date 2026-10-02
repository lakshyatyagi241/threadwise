import { describe, expect, it } from 'vitest';
import { CONSOLE_SIDEBAR_COOKIE, parseSidebarState, sidebarCookie } from './sidebar-state';

describe('parseSidebarState', () => {
  it('reads collapsed', () => {
    expect(parseSidebarState('collapsed')).toBe('collapsed');
  });

  it.each([undefined, null, '', 'expanded', 'COLLAPSED', 'collapsed ', 'yes'])(
    'treats %j as expanded',
    (value) => {
      expect(parseSidebarState(value)).toBe('expanded');
    },
  );
});

describe('sidebarCookie', () => {
  it('writes a site-wide, year-long, lax cookie that round-trips', () => {
    const c = sidebarCookie('collapsed');
    expect(c).toContain(`${CONSOLE_SIDEBAR_COOKIE}=collapsed`);
    expect(c).toContain('path=/');
    expect(c).toContain('max-age=31536000');
    expect(c).toContain('samesite=lax');
    const value = c.split(';')[0]!.split('=')[1];
    expect(parseSidebarState(value)).toBe('collapsed');
  });
});
