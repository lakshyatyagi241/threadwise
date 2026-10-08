import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every in-app link the flow builder shows ("Connect one on ...") must open a real screen: a link to a channel that was never
 * built is a 404 the customer meets while setting up a flow.
 */
const SRC = join(__dirname, '..', '..');
const APP = join(SRC, 'app');

function walk(dir: string, accept: (f: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, accept, out);
    else if (accept(full)) out.push(full);
  }
  return out;
}

/** `(app)/(settings)/settings/[section]/page.tsx` -> `/settings/[section]` (route groups are not part of the address). */
const routes = walk(APP, (f) => f.endsWith(`${sep}page.tsx`)).map(
  (f) =>
    '/' +
    relative(APP, f)
      .split(sep)
      .slice(0, -1)
      .filter((seg) => !(seg.startsWith('(') && seg.endsWith(')')))
      .join('/'),
);

const matches = (href: string): boolean => {
  const parts = href.split('/').filter(Boolean);
  return routes.some((r) => {
    const rp = r.split('/').filter(Boolean);
    return (
      rp.length === parts.length &&
      rp.every((seg, i) => (seg.startsWith('[') ? true : seg === parts[i]))
    );
  });
};

describe('flow builder links', () => {
  const files = walk(__dirname, (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));
  const hrefs = new Set<string>();
  for (const f of files)
    for (const m of readFileSync(f, 'utf8').matchAll(/href:\s*'(\/[a-z0-9/_-]*)'/g))
      hrefs.add(m[1]!);

  it('finds the builder links', () => {
    expect(hrefs.size).toBeGreaterThan(5);
  });

  it.each([...hrefs].sort())('%s opens a real screen', (href) => {
    expect(matches(href), `no page for ${href}`).toBe(true);
  });
});
