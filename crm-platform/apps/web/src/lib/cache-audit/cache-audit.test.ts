import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Cache-audit ratchets for the web app (Sheet3 #64): what the browser and Next.js remember must not outlive a sign-out, must not carry
 * a person's credentials into a shared cache, and must be written down in docs/performance/cache/register.json.
 */
const WEB = resolve(__dirname, '../..');
const REPO = resolve(WEB, '../../..');
const register = JSON.parse(readFileSync(join(REPO, 'docs/performance/cache/register.json'), 'utf8')) as {
  caches: Array<{ id: string; location: string }>;
  webNextCacheUsers: Record<string, string>;
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(WEB).map((f) => ({ file: relative(REPO, f).split('\\').join('/'), text: readFileSync(f, 'utf8') }));

/** Files that ask Next.js to cache a fetch or a page, and the rule they must follow. */
export function nextCacheViolations(
  src: Array<{ file: string; text: string }>,
  allowed: Record<string, string>,
): string[] {
  const out: string[] = [];
  const users = new Set<string>();
  for (const { file, text } of src) {
    const uses = /unstable_cache|next:\s*\{\s*revalidate|export const revalidate|fetchCache\s*=|export const dynamic\s*=\s*['"]force-static/.test(text);
    if (!uses) continue;
    users.add(file);
    if (!allowed[file]) out.push(`${file}: asks Next.js to cache but is not in register.json webNextCacheUsers.`);
    // A shared cache entry must not be made from a request that carries a person's credentials.
    const at = text.search(/next:\s*\{\s*revalidate|unstable_cache/);
    const block = at < 0 ? '' : text.slice(Math.max(0, at - 400), at + 200);
    if (/cookie|authorization|credentials:\s*['"]include/i.test(block)) out.push(`${file}: a cached fetch forwards cookies or an Authorization header.`);
  }
  for (const f of Object.keys(allowed)) if (!users.has(f)) out.push(`${f}: in webNextCacheUsers but no longer uses a Next.js cache.`);
  return out;
}

/** A sign-out that keeps the page alive keeps the TanStack Query cache of the old account. */
export function softSignOutViolations(src: Array<{ file: string; text: string }>): string[] {
  const out: string[] = [];
  for (const { file, text } of src) {
    if (file.endsWith('shared/sign-out.ts')) continue;
    if (!/fetch\(\s*['"`][^'"`]*\/logout['"`]/.test(text)) continue;
    const full = /window\.location\.(assign|replace)\(|from ['"][^'"]*shared\/sign-out['"]|queryClient\.clear\(\)/.test(text);
    if (!full) out.push(`${file}: signs out with a fetch but never leaves the page: the client query cache of the old account survives. Use signOut() from auth-registration-security/shared/sign-out.`);
  }
  return out;
}

describe('web cache ratchets: the real code', () => {
  it('every Next.js cache is registered and none is built from a credentialed request', () => {
    const v = nextCacheViolations(files, register.webNextCacheUsers);
    expect(v, v.join('\n')).toEqual([]);
  });

  it('every sign-out leaves the page (or clears the client cache)', () => {
    const v = softSignOutViolations(files);
    expect(v, v.join('\n')).toEqual([]);
  });

  it('the QueryClient defaults are the ones the register documents (staleTime 30 s, default gcTime)', () => {
    const providers = readFileSync(join(WEB, 'app/providers.tsx'), 'utf8');
    expect(providers).toContain('staleTime: 30_000');
    expect(providers).not.toMatch(/gcTime/);
  });

  it('a workspace switch clears the client cache', () => {
    expect(readFileSync(join(WEB, 'features/auth-registration-security/account/workspace-switcher.tsx'), 'utf8')).toContain('queryClient.clear()');
  });

  it('the screens that show secrets never keep them in the cache (gcTime 0)', () => {
    for (const f of ['features/whatsapp-devices-baileys/components/use-pairing-poll.ts', 'features/auth-registration-security/account/security/mfa-panel.tsx']) {
      expect(readFileSync(join(WEB, f), 'utf8'), f).toMatch(/gcTime:\s*0/);
    }
  });

  it('every register location in the web app exists', () => {
    for (const c of register.caches.filter((x) => x.location.startsWith('apps/web/')))
      expect(() => statSync(join(REPO, c.location)), c.id).not.toThrow();
  });
});

describe('web cache ratchets: each rule fails on a bad example', () => {
  it('a new revalidate fetch that is not registered is reported', () => {
    const bad = [{ file: 'apps/web/src/app/new/route.ts', text: "fetch(url, { next: { revalidate: 60 } })" }];
    expect(nextCacheViolations(bad, {}).join()).toContain('not in register.json webNextCacheUsers');
  });

  it('a revalidate fetch that forwards the cookie is reported', () => {
    const bad = [{ file: 'apps/web/src/app/new/route.ts', text: "fetch(url, { headers: { cookie: req.headers.get('cookie') }, next: { revalidate: 60 } })" }];
    expect(nextCacheViolations(bad, { 'apps/web/src/app/new/route.ts': 'x'.repeat(40) }).join()).toContain('forwards cookies');
  });

  it('a sign-out that only calls router.replace is reported', () => {
    const bad = [{ file: 'apps/web/src/components/menu.tsx', text: "await fetch('/api/auth/logout', { method: 'POST' }); router.replace('/login');" }];
    expect(softSignOutViolations(bad).join()).toContain('never leaves the page');
  });

  it('a sign-out through the shared helper passes', () => {
    const ok = [{ file: 'apps/web/src/components/menu.tsx', text: "import { signOut } from '@/features/auth-registration-security/shared/sign-out'; fetch('/api/auth/logout')" }];
    expect(softSignOutViolations(ok)).toEqual([]);
  });
});
