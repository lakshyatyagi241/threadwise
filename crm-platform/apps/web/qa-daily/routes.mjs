import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Route groups that need no sign-in, or are not explorable on their own. */
const PUBLIC = new Set(['(auth)', '(site)', '(operator-auth)', '(developer-rest-api-v1-docs)']);
const SKIP = new Set(['(embedded)', '(setup)', '(site-preview)']);

const isGroup = (s) => /^\(.*\)$/.test(s);
const title = (s) =>
  s
    .replace(/[()]/g, '')
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

/**
 * Every page of the web app, read from `src/app/**\/page.tsx` so a new page is explored the day it is added.
 * `kind` picks the sign-in: public (none), app (workspace admin), admin (platform operator).
 * `dynamic` pages ([id], [token]...) need real data, so they are listed in the feature file but not visited.
 */
export function discoverRoutes(appRoot = join(process.cwd(), 'src/app')) {
  const out = [];
  const walk = (dir, segs) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), [...segs, e.name]);
      else if (e.name === 'page.tsx') {
        if (segs[0] === 'api' || segs.some((s) => SKIP.has(s))) continue;
        const groups = segs.filter(isGroup);
        const root = groups[0];
        const kind = root === '(admin)' ? 'admin' : !root || PUBLIC.has(root) ? 'public' : 'app';
        out.push({
          url: '/' + segs.filter((s) => !isGroup(s)).join('/'),
          kind,
          area: title(groups[1] ?? groups[0] ?? '(home)'),
          dynamic: segs.some((s) => s.includes('[')),
        });
      }
    }
  };
  walk(appRoot, []);
  return out.sort((a, b) => a.url.localeCompare(b.url));
}
