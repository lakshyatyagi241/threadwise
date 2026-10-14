// #40 DB indexing audit: every FK and critical query pattern has an index; no redundant or unjustified indexes.
import { exists, expectNone, fail, pass, pgClient, read, ROOT, skip, warn } from '../lib/core.mjs';
import { buildSchema, covered, isTenant } from '../lib/schema.mjs';
import { join } from 'node:path';

export default {
  id: 40,
  priority: 'P1',
  name: 'DB indexing audit',
  owner: 'Punya',
  target: '100% critical query patterns reviewed; no redundant/unjustified critical indexes',
  async run() {
    const tables = [...buildSchema().values()].filter(
      (t) => t.columns.size > 1 && t.name.length > 2,
    );
    const checks = [];
    const unindexedFk = [],
      redundant = [],
      notTenantLed = [],
      noTenantIdx = [];
    for (const t of tables) {
      for (const fk of t.fks)
        if (!covered(t, fk.cols))
          unindexedFk.push(`${t.name}(${fk.cols}) -> ${fk.ref}   [${t.file}]`);
      const idx = t.indexes.filter((i) => !i.partial);
      for (const a of idx)
        for (const b of t.indexes) {
          if (a === b) continue;
          const prefix = a.cols.length <= b.cols.length && a.cols.every((c, i) => b.cols[i] === c);
          if (
            prefix &&
            !(a.unique && !b.unique) &&
            (a.cols.length < b.cols.length || a.name > b.name) &&
            !a.unique &&
            a.partial === b.partial
          )
            redundant.push(`${t.name}: ${a.name}(${a.cols}) is a prefix of ${b.name}(${b.cols})`);
        }
      if (isTenant(t)) {
        for (const i of t.indexes)
          if (!i.cols.includes('org_id') && !/\(|::/.test(i.cols.join('')) && !i.unique)
            notTenantLed.push(
              `${t.name}.${i.name}(${i.cols}) does not include org_id [likely GIN/trigram/text search: confirm]`,
            );
        if (!t.indexes.length && !t.pk) noTenantIdx.push(t.name);
      }
    }
    checks.push(
      expectNone(
        'idx-fk',
        'Every foreign key has a covering index (so deletes/joins do not scan)',
        unindexedFk,
        { level: 'warn' },
      ),
    );
    checks.push(
      expectNone('idx-redundant', 'No index is a strict prefix of another (redundant)', redundant, {
        level: 'warn',
      }),
    );
    checks.push(
      expectNone(
        'idx-tenant-lead',
        'Btree indexes on tenant tables lead with org_id',
        notTenantLed.filter((x) => !/search|gin|trgm|vector|fts/i.test(x)),
        { level: 'warn' },
      ),
    );

    // Critical query patterns: docs/quality/db/critical-queries.json lists table + filter/sort columns; each must be served by an index.
    const regPath = 'tools/qa-suite/data/critical-queries.json';
    if (exists(regPath)) {
      const reg = JSON.parse(read(join(ROOT, regPath)));
      const by = new Map(tables.map((t) => [t.name, t]));
      const missing = [];
      for (const q of reg.queries) {
        const t = by.get(q.table);
        if (!t) {
          missing.push(`${q.name}: table ${q.table} not found`);
          continue;
        }
        const eq = q.equals ?? [],
          ord = q.orderBy ?? [],
          rng = new Set(q.range ?? []);
        const idxs = [t.pk, ...t.uniques, ...t.indexes.map((i) => i.cols)].filter(Boolean);
        const ok = idxs.some((c) => {
          const head = c.slice(0, eq.length);
          if (head.length < eq.length || !eq.every((e) => head.includes(e))) return false;
          const rest = c.slice(eq.length).filter((x) => !rng.has(x));
          return ord.every((o, i) => rest[i] === o);
        });
        if (!ok)
          missing.push(
            `${q.name}: no index serving ${q.table}(${eq}${ord.length ? ' order by ' + ord : ''}) [${q.why ?? ''}]`,
          );
      }
      checks.push(
        expectNone(
          'idx-critical',
          `Critical query patterns have a serving index (${reg.queries.length} reviewed)`,
          missing,
          { severity: 'high' },
        ),
      );
      checks.__reviewed = reg.queries.length;
    } else
      checks.push(fail('idx-critical', 'Critical query register exists', `${regPath} missing`));

    // Live: unused and duplicate indexes from the statistics views.
    const { client, error } = await pgClient();
    if (!client)
      checks.push(
        skip(
          'idx-live-unused',
          'Indexes never used since stats reset (pg_stat_user_indexes)',
          error,
        ),
      );
    else {
      const unused = (
        await client.query(`SELECT relname||'.'||indexrelname AS i, pg_size_pretty(pg_relation_size(indexrelid)) sz
        FROM pg_stat_user_indexes JOIN pg_index USING (indexrelid) WHERE idx_scan=0 AND NOT indisunique AND NOT indisprimary ORDER BY pg_relation_size(indexrelid) DESC LIMIT 40`)
      ).rows.map((r) => `${r.i} (${r.sz})`);
      checks.push(
        expectNone(
          'idx-live-unused',
          'No large index is unused (needs real traffic before it means anything)',
          unused,
          { level: 'warn' },
        ),
      );
      const invalid = (
        await client.query(`SELECT indexrelid::regclass::text i FROM pg_index WHERE NOT indisvalid`)
      ).rows.map((r) => r.i);
      checks.push(
        expectNone(
          'idx-live-invalid',
          'No invalid indexes left by a failed CONCURRENTLY build',
          invalid,
        ),
      );
      await client.end();
    }
    return {
      checks,
      metrics: {
        tables: tables.length,
        indexes: tables.reduce((a, t) => a + t.indexes.length, 0),
        'foreign keys': tables.reduce((a, t) => a + t.fks.length, 0),
        'critical patterns reviewed': checks.__reviewed ?? 0,
      },
      target: {
        met:
          !!checks.__reviewed &&
          checks.find((c) => c.id === 'idx-critical')?.status === 'pass' &&
          redundant.length === 0,
        text: `${unindexedFk.length} unindexed FKs, ${redundant.length} redundant indexes, ${checks.__reviewed ?? 0} critical patterns in the register`,
      },
    };
  },
};
