// Fills the :params of a route with ids that exist in the seeded organisation, so a detail route answers 200 and its latency is a real one.
// A parameter that matches no table gets a fixed id and the route is marked unresolved: its 404 is not a latency result.
const MISSING_UUID = '00000000-0000-4000-8000-000000000001';

/** Map of table name -> sample uuids of one organisation, for every table that has an org_id and a uuid column. */
export function paramPools(psql, orgId) {
  const tables = psql(
    `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'uuid'
     INTERSECT SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'org_id'
     ORDER BY 1`,
  )
    .split('\n')
    .filter((t) => /^[a-z0-9_]+$/.test(t)); // the names are interpolated below: only plain identifiers get through
  const pools = new Map();
  const CHUNK = 60;
  for (let i = 0; i < tables.length; i += CHUNK) {
    const sql = tables
      .slice(i, i + CHUNK)
      .map(
        (t) =>
          `(SELECT '${t}' AS t, uuid::text AS u FROM ${t} WHERE org_id = ${Number(orgId)} LIMIT 3)`,
      )
      .join(' UNION ALL ');
    for (const line of psql(sql).split('\n').filter(Boolean)) {
      const [t, u] = line.split('\t');
      pools.set(t, [...(pools.get(t) ?? []), u]);
    }
  }
  // a workspace is the tenant, not a row of one, so it has no org_id column: add it by hand
  const ws = psql(`SELECT uuid::text FROM organizations WHERE id = ${Number(orgId)}`).trim();
  if (ws) pools.set('organizations', [ws]);
  return pools;
}

const snake = (s) =>
  s
    .replace(/(Id|Uuid|ID)$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();
const plurals = (w) =>
  [w, `${w}s`, `${w}es`, w.endsWith('y') ? `${w.slice(0, -1)}ies` : null].filter(Boolean);

/** Table names a parameter could stand for, best first: its own name, or (for :id) the static segments before it, nearest first. */
export function candidates(param, staticBefore) {
  const words = /^(id|uuid)$/i.test(param)
    ? [...staticBefore].reverse().map(snake)
    : [snake(param)];
  const out = [];
  for (const w of words) {
    out.push(...plurals(w));
    const tail = w.split('_').pop();
    if (tail !== w) out.push(...plurals(tail)); // last resort: the last word of a prefixed name
  }
  return out;
}

export function resolveUrl(url, pools) {
  const staticBefore = [];
  let resolved = true;
  const out = url.split('/').map((seg) => {
    if (!seg.startsWith(':')) {
      if (seg && !/^v\d+$/.test(seg)) staticBefore.push(seg);
      return seg;
    }
    const param = seg.slice(1);
    const table = candidates(param, staticBefore).find((t) => pools.has(t));
    if (table) return pools.get(table)[0];
    resolved = false;
    return /(slug|key|code|name|token|provider|kind|type)$/i.test(param) ? 'x' : MISSING_UUID;
  });
  return { url: out.join('/'), resolved };
}
