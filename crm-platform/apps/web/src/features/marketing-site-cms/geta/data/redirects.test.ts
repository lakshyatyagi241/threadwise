import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANNELS, PRODUCTS } from './products';
import { NICHES } from './niches';
import { LEGACY_REDIRECTS } from './redirects';
import { INDUSTRIES, USE_CASES } from './solutions';

/** Pages with a fixed address on the site, plus the ones the CMS and the app own. */
const STATIC = new Set([
  '/',
  '/platform',
  '/about',
  '/contact',
  '/security',
  '/get-started',
  '/register',
  '/blog',
  '/products/channels',
]);

function exists(path: string): boolean {
  // A pattern keeps its prefix: `/blog/:path*` lands on the blog, `/blog/<post>` on a post written in the editor.
  const p = path.replace(/\/:[^/]+\*$/, '');
  if (STATIC.has(p)) return true;
  if (/^\/blog\/[a-z0-9-]+$/.test(p)) return true;
  if (/^\/legal\/(privacy|terms|cookies)$/.test(p)) return true;
  const [, a, b, c] = p.split('/');
  if (a === 'products' && b === 'channels' && c) return CHANNELS.some((x) => x.slug === c);
  if (a === 'products' && b && !c) return PRODUCTS.some((x) => x.slug === b);
  if (a === 'solutions' && b && !c) return INDUSTRIES.some((x) => x.slug === b);
  if (a === 'use-cases' && b && !c) return USE_CASES.some((x) => x.slug === b);
  return false;
}

/** URL paths of the pages the signed-in app, the admin console and the sign-in screens serve (route groups left out). */
function appPaths(): Set<string> {
  const root = join(process.cwd(), 'src', 'app');
  const out = new Set<string>();
  const walk = (dir: string, url: string) => {
    if (existsSync(join(dir, 'page.tsx'))) out.add(url || '/');
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const seg = /^\(.*\)$/.test(e.name) ? '' : `/${e.name}`;
      walk(join(dir, e.name), url + seg);
    }
  };
  for (const g of ['(app)', '(admin)', '(auth)'])
    if (existsSync(join(root, g))) walk(join(root, g), '');
  return out;
}

describe('legacy redirects', () => {
  it('only point at pages that exist', () => {
    const missing = LEGACY_REDIRECTS.filter((r) => !exists(r.destination)).map(
      (r) => `${r.source} -> ${r.destination}`,
    );
    expect(missing).toEqual([]);
  });

  it('list each address once', () => {
    const sources = LEGACY_REDIRECTS.map((r) => r.source);
    expect(sources.filter((s, i) => sources.indexOf(s) !== i)).toEqual([]);
  });

  it('never redirect a page the site still serves', () => {
    const live = LEGACY_REDIRECTS.filter((r) => exists(r.source));
    expect(live.map((r) => r.source)).toEqual([]);
  });

  it('never redirect a page of the signed-in app', () => {
    const app = appPaths();
    expect(LEGACY_REDIRECTS.filter((r) => app.has(r.source)).map((r) => r.source)).toEqual([]);
  });

  it('never send an address to itself', () => {
    expect(LEGACY_REDIRECTS.filter((r) => r.source === r.destination)).toEqual([]);
  });
});

describe('niche links', () => {
  it('each business type on the home page has a page', () => {
    const missing = NICHES.filter((n) => !exists(n.href)).map((n) => n.href);
    expect(missing).toEqual([]);
  });
});
