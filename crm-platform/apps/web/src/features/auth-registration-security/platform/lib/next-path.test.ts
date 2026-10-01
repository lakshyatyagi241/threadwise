import { describe, expect, it } from 'vitest';
import { safeConsolePath } from './next-path';

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
