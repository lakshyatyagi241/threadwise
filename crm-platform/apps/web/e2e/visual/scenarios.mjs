import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The visual scenarios, generated from `src/app/**\/page.tsx` the way the route matrix does, so a new page is a scenario the day it is
 * added. One scenario is one page at one viewport; its id is also the baseline file name. Plain JavaScript so the spec and the tools
 * under tools/visual (coverage, flake) read the very same list: the number in the report is the number the spec runs.
 *
 * @typedef {'P0'|'P1'|'P2'} Priority
 * @typedef {{ id: string, url: string, priority: Priority, authed: boolean, viewport: string, width: number, height: number }} Scenario
 */

/** @param {string} [root] apps/web */
export const loadConfig = (root = process.cwd()) =>
  JSON.parse(readFileSync(join(root, 'e2e/visual/visual.config.json'), 'utf8'));

const prefixMatch = (url, prefix) =>
  prefix === '/' ? url === '/' : url === prefix || url.startsWith(prefix + '/');

/** p0 and p2 win by the longest matching prefix; every other page is p1. @returns {Priority} */
export function priorityOf(url, cfg) {
  const longest = (list) =>
    list.reduce((n, p) => (prefixMatch(url, p) ? Math.max(n, p.length) : n), -1);
  const a = longest(cfg.p0);
  const b = longest(cfg.p2);
  if (a < 0 && b < 0) return 'P1';
  return a >= b ? 'P0' : 'P2';
}

/** Every static page route, and how many pages are left out because they need data or are not the staff app. */
export function discoverPages(root = process.cwd(), cfg = loadConfig(root)) {
  const pages = [];
  let dynamic = 0;
  let skipped = 0;
  const walk = (dir, segs) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), [...segs, e.name]);
      else if (e.name === 'page.tsx') {
        if (segs.some((s) => s.includes('['))) dynamic++;
        else if (segs.some((s) => cfg.skipGroups.includes(s) || s === 'api')) skipped++;
        else
          pages.push({
            url: '/' + segs.filter((s) => !/^\(.*\)$/.test(s)).join('/'),
            authed: segs.some((s) => cfg.authedGroups.includes(s)),
          });
      }
    }
  };
  walk(join(root, 'src/app'), []);
  pages.sort((x, y) => x.url.localeCompare(y.url));
  return { pages, dynamic, skipped };
}

export const scenarioId = (url, viewport) =>
  `${url === '/' ? 'home' : url.slice(1).replace(/\//g, '--')}-${viewport}`;

/** @returns {Scenario[]} */
export function buildScenarios(root = process.cwd()) {
  const cfg = loadConfig(root);
  const out = [];
  for (const p of discoverPages(root, cfg).pages) {
    const priority = priorityOf(p.url, cfg);
    for (const vp of cfg.viewportsByPriority[priority]) {
      const size = cfg.viewports[vp];
      out.push({
        id: scenarioId(p.url, vp),
        url: p.url,
        priority,
        authed: p.authed,
        viewport: vp,
        ...size,
      });
    }
  }
  return out;
}
