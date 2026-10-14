// Builds a schema model (tables, columns, PKs, FKs, indexes, RLS) by replaying the hand-written SQL migrations in order.
// Static and approximate on purpose: it is the no-database fallback. The live checks read pg_catalog instead.
import { migrations, read, rel } from './core.mjs';

const strip = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const splitTop = (s) => {
  // split on commas that are not inside parentheses
  const out = [];
  let d = 0,
    cur = '';
  for (const ch of s) {
    if (ch === '(') d++;
    if (ch === ')') d--;
    if (ch === ',' && d === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
const ident = (s) =>
  s
    .replace(/"/g, '')
    .replace(/^public\./, '')
    .trim()
    .toLowerCase();
const cols = (s) =>
  s
    .split(',')
    .map((c) =>
      ident(
        c
          .trim()
          .replace(/\s+(asc|desc|nulls.*|[a-z_]+_ops)$/i, '')
          .split(/\s+/)[0],
      ),
    )
    .filter(Boolean);

export function buildSchema(files = migrations()) {
  const tables = new Map();
  const T = (n) => {
    n = ident(n);
    if (!tables.has(n))
      tables.set(n, {
        name: n,
        columns: new Map(),
        pk: null,
        fks: [],
        indexes: [],
        uniques: [],
        checks: 0,
        rls: false,
        forced: false,
        policies: [],
        partitioned: false,
        file: null,
      });
    return tables.get(n);
  };
  for (const file of files) {
    const sql = strip(read(file));
    for (const m of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)\s*\(([\s\S]*?)\)\s*(PARTITION\s+BY[^;]*)?;/gi,
    )) {
      const t = T(m[1]);
      t.file ??= rel(file);
      if (m[3]) t.partitioned = true;
      for (const item of splitTop(m[2])) {
        let r;
        if ((r = item.match(/^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i)))
          t.pk = cols(r[1]);
        else if (
          (r = item.match(
            /^(?:CONSTRAINT\s+\S+\s+)?FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+([\w."]+)\s*(?:\(([^)]*)\))?/i,
          ))
        )
          t.fks.push({ cols: cols(r[1]), ref: ident(r[2]), refCols: r[3] ? cols(r[3]) : null });
        else if ((r = item.match(/^(?:CONSTRAINT\s+\S+\s+)?UNIQUE\s*\(([^)]*)\)/i)))
          t.uniques.push(cols(r[1]));
        else if (/^(CONSTRAINT\s+\S+\s+)?CHECK/i.test(item)) t.checks++;
        else if (/^(LIKE|EXCLUDE)/i.test(item)) continue;
        else if ((r = item.match(/^"?(\w+)"?\s+([\w\[\]() ,]+?)(?:\s|$)/))) {
          const name = r[1].toLowerCase();
          t.columns.set(name, {
            type: r[2],
            notNull: /NOT\s+NULL/i.test(item) || /PRIMARY\s+KEY/i.test(item),
          });
          if (/PRIMARY\s+KEY/i.test(item)) t.pk = [name];
          if (/\bUNIQUE\b/i.test(item)) t.uniques.push([name]);
          if (/\bCHECK\b/i.test(item)) t.checks++;
          const ref = item.match(/REFERENCES\s+([\w."]+)\s*(?:\(([^)]*)\))?/i);
          if (ref)
            t.fks.push({ cols: [name], ref: ident(ref[1]), refCols: ref[2] ? cols(ref[2]) : null });
        }
      }
    }
    for (const m of sql.matchAll(
      /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(?:ONLY\s+)?([\w."]+)\s*(?:USING\s+\w+\s*)?\(([\s\S]*?)\)\s*(INCLUDE[^;]*|WHERE[^;]*)?;/gi,
    ))
      T(m[3]).indexes.push({
        name: m[2].toLowerCase(),
        unique: !!m[1],
        cols: cols(m[4]),
        partial: /WHERE/i.test(m[5] ?? ''),
        file: rel(file),
      });
    for (const m of sql.matchAll(
      /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?([\w."]+)\s+([^;]*);/gi,
    )) {
      const t = T(m[1]),
        body = m[2];
      for (const a of body.matchAll(/DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi)) {
        const c = a[1].toLowerCase();
        t.columns.delete(c);
        t.indexes = t.indexes.filter((i) => !i.cols.includes(c));
        t.uniques = t.uniques.filter((u) => !u.includes(c));
        t.fks = t.fks.filter((k) => !k.cols.includes(c));
        if (t.pk?.includes(c)) t.pk = t.pk.filter((x) => x !== c);
      }
      for (const a of body.matchAll(/RENAME\s+COLUMN\s+"?(\w+)"?\s+TO\s+"?(\w+)"?/gi)) {
        const [from, to] = [a[1].toLowerCase(), a[2].toLowerCase()],
          re = (l) => l.map((x) => (x === from ? to : x));
        if (t.columns.has(from)) {
          t.columns.set(to, t.columns.get(from));
          t.columns.delete(from);
        }
        t.indexes.forEach((i) => (i.cols = re(i.cols)));
        t.uniques = t.uniques.map(re);
        t.fks.forEach((k) => (k.cols = re(k.cols)));
        if (t.pk) t.pk = re(t.pk);
      }
      const rn = body.match(/^\s*RENAME\s+TO\s+"?(\w+)"?\s*$/i);
      if (rn) {
        const to = rn[1].toLowerCase();
        t.name = to;
        tables.set(to, t);
        tables.delete(ident(m[1]));
        continue;
      }
      if (/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(body)) t.rls = true;
      if (/FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(body)) t.forced = true;
      for (const a of body.matchAll(
        /ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s+([\w\[\]() ,]+?)(?:\s+(?:NOT|NULL|DEFAULT|REFERENCES|GENERATED|CHECK|UNIQUE|PRIMARY)\b|,|$)/gi,
      ))
        if (!/^(constraint|primary|foreign|unique|check)$/i.test(a[1]))
          t.columns.set(a[1].toLowerCase(), { type: a[2], notNull: false });
      for (const a of body.matchAll(
        /ADD\s+(?:CONSTRAINT\s+\S+\s+)?FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+([\w."]+)\s*(?:\(([^)]*)\))?/gi,
      ))
        t.fks.push({ cols: cols(a[1]), ref: ident(a[2]), refCols: a[3] ? cols(a[3]) : null });
      for (const a of body.matchAll(/ADD\s+(?:CONSTRAINT\s+\S+\s+)?UNIQUE\s*\(([^)]*)\)/gi))
        t.uniques.push(cols(a[1]));
      for (const a of body.matchAll(/ADD\s+(?:CONSTRAINT\s+\S+\s+)?CHECK/gi)) t.checks++;
      for (const a of body.matchAll(/ADD\s+(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/gi))
        t.pk = cols(a[1]);
    }
    // Loops like DO $$ ... tenant_tables := ARRAY['a','b']; EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t) ... $$
    if (/format\(\s*'ALTER TABLE %I\s+FORCE\s+ROW/i.test(sql))
      for (const arr of sql.matchAll(/ARRAY\s*\[([^\]]*)\]/gi))
        for (const q of arr[1].matchAll(/'([\w.]+)'/g)) {
          const t = tables.get(ident(q[1]));
          if (t) {
            t.rls = true;
            t.forced = true;
            t.viaLoop = true;
          }
        }
    for (const m of sql.matchAll(/CREATE\s+POLICY\s+(\w+)\s+ON\s+([\w."]+)/gi))
      T(m[2]).policies.push(m[1].toLowerCase());
    for (const m of sql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w."]+)/gi))
      tables.delete(ident(m[1]));
    for (const m of sql.matchAll(/DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(\w+)/gi))
      for (const t of tables.values())
        t.indexes = t.indexes.filter((i) => i.name !== m[1].toLowerCase());
    // ensure_monthly_partition('x') style helper means x is partitioned
    for (const m of sql.matchAll(/PARTITION\s+OF\s+([\w."]+)/gi)) T(m[1]);
  }
  // partition children are not independent tables
  for (const [n, t] of [...tables])
    if (/_(default|\d{4}_\d{2}|p\d{6}|y\d{4}m\d{2})$/.test(n) && !t.columns.size) tables.delete(n);
  return tables;
}
export const isTenant = (t) => t.columns.has('org_id');
// Does some index (or the PK / a unique) on `t` start with the columns of `fkCols`?
export const covered = (t, fkCols) => {
  const starts = (list) =>
    list.length >= fkCols.length &&
    new Set(list.slice(0, fkCols.length)).size === fkCols.length &&
    fkCols.every((c) => list.slice(0, fkCols.length).includes(c));
  return [t.pk, ...t.uniques, ...t.indexes.map((i) => i.cols)].filter(Boolean).some(starts);
};
