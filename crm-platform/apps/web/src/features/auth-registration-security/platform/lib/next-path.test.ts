import { describe, expect, it } from 'vitest';
import { operatorLoginPath, safeConsolePath } from './next-path';

describe('safeConsolePath', () => {
  const fallback = '/admin/security';
  it('keeps console paths, with a query string', () => {
    expect(safeConsolePath('/admin/settings/auth-pages', fallback)).toBe(
      '/admin/settings/auth-pages',
    );
    expect(safeConsolePath('/admin/security/events?event=auth.failed', fallback)).toBe(
      '/admin/security/events?event=auth.failed',
    );
    expect(safeConsolePath('/admin', fallback)).toBe('/admin');
  });
  it('refuses anything that could leave the console', () => {
    for (const bad of [
      'https://evil.test',
      '//evil.test',
      '/\\evil',
      '/administrator',
      '/login',
      '/admin//x',
      '/admin/../x',
      'admin/security',
    ]) {
      expect(safeConsolePath(bad, fallback)).toBe(fallback);
    }
  });
  it('does not bounce back to the sign-in page', () =>
    expect(safeConsolePath('/admin/login', fallback)).toBe(fallback));
  it('falls back when empty', () => {
    expect(safeConsolePath(undefined, fallback)).toBe(fallback);
    expect(safeConsolePath('', fallback)).toBe(fallback);
  });
});

describe('operatorLoginPath', () => {
  it('names the reason and keeps the console page the operator was on', () => {
    expect(operatorLoginPath('/admin/security/events?event=auth.failed')).toBe(
      '/admin/login?expired=1&next=%2Fadmin%2Fsecurity%2Fevents%3Fevent%3Dauth.failed',
    );
  });

  it('says idle, with the limit, when the session ended for inactivity', () => {
    expect(operatorLoginPath('/admin/settings/registration', { idleMinutes: 30 })).toBe(
      '/admin/login?expired=idle&minutes=30&next=%2Fadmin%2Fsettings%2Fregistration',
    );
  });

  it('falls back to the plain reason without a usable limit', () => {
    expect(operatorLoginPath('/admin/events', { idleMinutes: 0 })).toContain('expired=1');
  });

  it('drops next for the console home, the sign-in page and anything outside the console', () => {
    expect(operatorLoginPath('/admin')).toBe('/admin/login?expired=1');
    expect(operatorLoginPath('/admin/login?expired=1')).toBe('/admin/login?expired=1');
    expect(operatorLoginPath('/inbox')).toBe('/admin/login?expired=1');
    expect(operatorLoginPath('//evil.example')).toBe('/admin/login?expired=1');
    expect(operatorLoginPath(null)).toBe('/admin/login?expired=1');
  });
});
