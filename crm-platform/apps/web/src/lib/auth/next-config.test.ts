import { describe, expect, it } from 'vitest';
import nextConfig from '../../../next.config';

type Rule = { source: string; headers: Array<{ key: string; value: string }> };

async function rules(): Promise<Rule[]> {
  const headers = nextConfig.headers;
  if (!headers) throw new Error('next.config has no headers()');
  return (await headers()) as Rule[];
}

/** Next matches `source` as a path pattern; `:path*` means "and anything below". */
function matches(source: string, path: string): boolean {
  const pattern = source
    .replace(/\/:\w+\*/g, '(?:/.*)?')
    .replace(/:\w+/g, '[^/]+')
    .replace(/^\/\((.*)\)$/, '/($1)');
  return new RegExp(`^${pattern}$`).test(path);
}

const valueOf = (rule: Rule, key: string) => rule.headers.find((h) => h.key === key)?.value;

describe('next.config headers (TW-AUTH-020 / 045)', () => {
  it('keeps every sign-in and recovery page out of every cache, with the legacy Pragma header too', async () => {
    const all = await rules();
    for (const path of [
      '/login',
      '/logout',
      '/signup',
      '/forgot-password',
      '/reset-password',
      '/reset-password/abc123',
      '/verify-email',
      '/verify-otp',
      '/find-workspace',
      '/onboarding',
      '/suspended',
      '/verify-email-required',
    ]) {
      const hit = all.find((r) => valueOf(r, 'Cache-Control') && matches(r.source, path));
      expect(hit, path).toBeTruthy();
      expect(valueOf(hit!, 'Cache-Control')).toContain('no-store');
      expect(valueOf(hit!, 'Pragma')).toBe('no-cache');
    }
  });

  it('refuses framing everywhere except the embeddable chat widget', async () => {
    const security = (await rules()).find((r) => valueOf(r, 'X-Frame-Options'));
    expect(security).toBeTruthy();
    expect(valueOf(security!, 'X-Frame-Options')).toBe('SAMEORIGIN');
    expect(valueOf(security!, 'Content-Security-Policy')).toContain("frame-ancestors 'self'");
    const re = new RegExp(`^${security!.source}$`);
    for (const path of ['/login', '/dashboard', '/account/security', '/widgets', '/widgeting']) {
      expect(re.test(path), path).toBe(true);
    }
    for (const path of ['/widget', '/widget/abc', '/widget/embed.js']) {
      expect(re.test(path), path).toBe(false);
    }
  });
});

describe('next.config redirects: addresses bookmarks and old emails may still carry', () => {
  it('maps each Reference address to its counterpart', async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    const to = (source: string) => redirects.find((r) => r.source === source)?.destination;
    expect(to('/home')).toBe('/');
    expect(to('/register/verify')).toBe('/verify-otp');
    expect(to('/register/workspace')).toBe('/onboarding');
    expect(to('/register/plan')).toBe('/onboarding');
    expect(to('/account/suspended')).toBe('/suspended');
    expect(to('/account/verify-email')).toBe('/verify-email-required');
    expect(to('/reset-password/:token')).toBe('/reset-password?token=:token');
  });

  it('are temporary, so a later real page at one of these addresses is not shadowed in caches', async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    expect(redirects.length).toBeGreaterThanOrEqual(7);
    for (const r of redirects) expect(r.permanent, r.source).toBe(false);
  });
});
