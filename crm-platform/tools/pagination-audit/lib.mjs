// Pagination audit library (QA task 45). Pure functions over source text.
//
// Three questions, asked of every list route the API serves:
//   1. How does it page: a keyset cursor, a page number, an offset, or not at all?
//   2. Is the size bounded: does the query schema cap `limit` / `pageSize` / `perPage`?
//   3. Where does SQL skip rows with OFFSET (cost grows with the page number) or count every row on every page?
// A route that pages by number or offset is not wrong (a numbered page is what some screens show), but each one is a written decision.

const PAGE_KEYS = ['limit', 'pageSize', 'perPage', 'per_page', 'take', 'size'];

/** Style of paging a zod query schema body declares. */
export function styleOfSchema(body) {
  if (/\bcursor\b|paginationQuerySchema|cursorSchema|\bafter\b\s*:/.test(body)) return 'cursor';
  if (/\boffset\b/.test(body)) return 'offset';
  if (/\bpage\b\s*:/.test(body) || /\bpage\b\s*:\s*z/.test(body)) return 'page';
  if (PAGE_KEYS.some((k) => new RegExp(`\\b${k}\\b\\s*:`).test(body))) return 'limit-only';
  return 'none';
}

/** The text of one key of a schema body: from `key:` to the next key at the same indent (or the end). */
function keyText(body, k) {
  const m = new RegExp(`(^|[\\s,{])${k}\\s*:`).exec(body);
  if (!m) return null;
  const rest = body.slice(m.index + m[0].length);
  const next = /\n\s{1,4}[a-zA-Z_]+\s*:/.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** The cap of the size key, null when there is a size key with no max, undefined when there is no size key (a fixed page size). */
export function capOfSchema(body) {
  for (const k of PAGE_KEYS) {
    const t = keyText(body, k);
    if (t === null) continue;
    const mx = /\.max\(\s*([\w.]+)\s*\)/.exec(t);
    if (mx) return mx[1];
    if (/Math\.min\(\s*[\w.]+\s*,/.test(t)) return 'clamped';
    return /paginationQuerySchema/.test(body) ? '200' : null;
  }
  return /paginationQuerySchema/.test(body) ? '200' : undefined;
}

/** The highest page number a page-number schema accepts, null when there is none (any page, however deep, reaches the database). */
export function maxPageOf(body, consts = {}) {
  let t = keyText(body, 'page');
  if (t === null || /uuid|string|enum/.test(t.split('\n')[0])) return undefined; // a page named by an id, not a number
  const ref = /^\s*(\w+)\s*[,}\n]/.exec(t.split('//')[0] + '\n');
  if (ref && consts[ref[1]]) t = consts[ref[1]];
  return /\.max\(\s*([\w.]+)\s*\)/.exec(t)?.[1] ?? null;
}

/** Every `export const xSchema = z.object({ ... })` of a contracts file: name -> body text. */
export function schemasOf(src) {
  const out = {};
  const re =
    /export const (\w+Schema)\s*=\s*(?:z\.object|paginationQuerySchema\.extend|\w+\.extend)\(\s*\{?/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{' || c === '(') depth++;
      else if (c === '}' || c === ')') {
        depth--;
        if (depth <= 0) break;
      }
    }
    out[m[1]] =
      src.slice(start, i + 1) +
      (/paginationQuerySchema\.extend/.test(m[0]) ? ' paginationQuerySchema' : '');
  }
  return out;
}

/** GET routes of a controller that take a `@Query(... xSchema)` argument: [{ handler, schema }]. */
export function queryRoutesOf(src) {
  const out = [];
  const re = /@Get\(([^)]*)\)[\s\S]*?\n\s*(?:async\s+)?(\w+)\s*\(([\s\S]*?)\)\s*[{:]/g;
  let m;
  while ((m = re.exec(src))) {
    const q = /@Query\(\s*(?:zodPipe\(\s*)?(\w+Schema)/.exec(m[3]);
    if (q) out.push({ route: m[1].replace(/['"`]/g, '') || '/', handler: m[2], schema: q[1] });
  }
  return out;
}

/** SQL that skips rows: OFFSET in a sql template or Drizzle `.offset(`. [{ line, text }] */
export function offsetSites(src) {
  const out = [];
  src.split('\n').forEach((text, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(text)) return;
    if (/\bOFFSET\s*\$\{|\bOFFSET\s+\d|\.offset\(/.test(text))
      out.push({ line: i + 1, text: text.trim().slice(0, 140) });
  });
  return out;
}

/** `count(*)` in SQL (a total that is computed for every page). */
export const countSites = (src) =>
  src
    .split('\n')
    .flatMap((text, i) =>
      /count\(\*\)/i.test(text) && !/^\s*(\/\/|\*)/.test(text) ? [{ line: i + 1 }] : [],
    );

/** Findings of the register check: a new OFFSET site is a failure until it has a decision; a decision for a site that is gone is stale. */
export function checkRegister({ sites, register }) {
  const findings = [];
  const known = new Map(register.map((r) => [r.file, r]));
  const have = new Map();
  for (const s of sites) have.set(s.file, (have.get(s.file) ?? 0) + 1);
  for (const [file, n] of have) {
    const r = known.get(file);
    if (!r)
      findings.push({
        severity: 'High',
        subject: file,
        detail: `${n} OFFSET site(s) with no decision: page by cursor, or record why a numbered page is needed`,
      });
    else if (!r.reason || !r.owner || !r.status)
      findings.push({
        severity: 'High',
        subject: file,
        detail: 'its decision lacks a reason, an owner or a status',
      });
    else if (n > r.sites)
      findings.push({
        severity: 'High',
        subject: file,
        detail: `${n} OFFSET sites, the decision covers ${r.sites}: a new one was added`,
      });
  }
  for (const r of register)
    if (!have.has(r.file))
      findings.push({
        severity: 'Medium',
        subject: r.file,
        detail: 'has a decision but no OFFSET site is left: delete the decision',
      });
  return findings;
}
