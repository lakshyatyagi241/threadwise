// #44 Connection-pool tuning: pool size x instances fits inside Postgres max_connections; timeouts and error handling are set.
import {
  ROOT,
  expectNone,
  fail,
  pass,
  pgClient,
  read,
  rel,
  skip,
  walk,
  warn,
} from '../lib/core.mjs';
import { join } from 'node:path';

export default {
  id: 44,
  priority: 'P1',
  name: 'Connection-pool tuning',
  owner: 'Punya',
  target: '100% critical data paths reviewed; measurable before/after evidence',
  async run() {
    const checks = [],
      facts = {};
    const client = read(join(ROOT, 'packages/db/src/client.ts'));
    facts.poolDefault = +(client.match(/options\.poolMax \?\? (\d+)/)?.[1] ?? 0);
    facts.idleMs = +(client.match(/idleTimeoutMillis:\s*([\d_]+)/)?.[1].replace(/_/g, '') ?? 0);
    facts.connMs = +(
      client.match(/connectionTimeoutMillis:\s*([\d_]+)/)?.[1].replace(/_/g, '') ?? 0
    );
    facts.stmtMs = +(client.match(/statementTimeoutMs \?\? ([\d_]+)/)?.[1].replace(/_/g, '') ?? 0);
    checks.push(
      facts.connMs > 0 && facts.connMs <= 15000
        ? pass('pool-conn-timeout', `Waiting for a connection fails fast (${facts.connMs} ms)`)
        : fail(
            'pool-conn-timeout',
            'connectionTimeoutMillis is set to <= 15 s',
            `found ${facts.connMs}`,
          ),
    );
    checks.push(
      facts.stmtMs > 0 && facts.stmtMs <= 30000
        ? pass(
            'pool-stmt-timeout',
            `Runaway queries die at the database (statement_timeout ${facts.stmtMs} ms)`,
          )
        : fail('pool-stmt-timeout', 'statement_timeout is set to <= 30 s', `found ${facts.stmtMs}`),
    );
    checks.push(
      facts.idleMs > 0
        ? pass('pool-idle', `Idle connections are recycled (${facts.idleMs} ms)`)
        : warn('pool-idle', 'idleTimeoutMillis is set'),
    );
    checks.push(
      /pool\.on\(\s*'error'/.test(client)
        ? pass('pool-error-handler', 'Idle-client errors are handled (no process crash)')
        : fail('pool-error-handler', 'pool.on("error") handler exists'),
    );
    checks.push(
      /DB_POOL_MAX/.test(read(join(ROOT, 'apps/api/src/config/env.schema.ts')))
        ? pass('pool-configurable', 'Pool size is configurable per deployment (DB_POOL_MAX)')
        : fail('pool-configurable', 'Pool size is configurable'),
    );

    // Budget: for each compose file, (app services x pool size) must leave headroom under max_connections.
    const over = [],
      rows = [];
    for (const f of [...walk(ROOT, (p) => /docker-compose[^/]*\.ya?ml$/.test(p))]) {
      const y = read(f);
      const max = +(y.match(/max_connections=(\d+)/)?.[1] ?? 0);
      if (!max) continue;
      const pool = +(
        y.match(/DB_POOL_MAX:\s*['"]?(\d+)/)?.[1] ??
        y.match(/DB_POOL_MAX[:=-]+\s*(\d+)/)?.[1] ??
        facts.poolDefault
      );
      // services that run the API image/entrypoint: api and worker (each opens its own pool)
      const svc =
        (y.match(/^\s{2}(api|worker|api-worker|crm-api|crm-worker)[\w-]*:\s*$/gm) ?? []).length ||
        2;
      const need = svc * pool,
        reserve = Math.ceil(max * 0.1) + 5; // superuser reserve + migrations/psql/monitoring
      rows.push(
        `${rel(f)}: ${svc} app service(s) x pool ${pool} = ${need} of max_connections ${max} (reserve ${reserve})`,
      );
      if (need > max - reserve) over.push(rows.at(-1));
    }
    checks.push(
      expectNone(
        'pool-budget',
        'Pool size x app instances fits inside max_connections with headroom (single replica each; multiply by replicas when scaling)',
        over,
        { severity: 'high' },
      ),
    );
    checks.push({
      id: 'pool-budget-table',
      title: 'Connection budget per compose file',
      status: 'pass',
      detail: `${rows.length} file(s)`,
      evidence: rows,
    });
    const bouncer = [...walk(ROOT, (p) => /(docker-compose|\.ya?ml)$/.test(p))].some((f) =>
      /pgbouncer/i.test(read(f)),
    );
    checks.push(
      bouncer
        ? pass('pool-pgbouncer', 'PgBouncer in front of Postgres')
        : warn(
            'pool-pgbouncer',
            'No PgBouncer: every app replica holds its own pool directly on Postgres',
            'Fine for a few replicas. Past ~10 replicas, put a transaction-mode pooler in front (note: SET LOCAL per transaction, which RLS uses, is compatible with transaction pooling).',
          ),
    );

    const { client: pg, error } = await pgClient();
    if (!pg)
      checks.push(
        skip('pool-live', 'Live connections vs max_connections (pg_stat_activity)', error),
      );
    else {
      const r = (
        await pg.query(
          `SELECT count(*)::int total, count(*) FILTER (WHERE state='idle in transaction')::int idle_tx, current_setting('max_connections')::int max FROM pg_stat_activity WHERE datname=current_database()`,
        )
      ).rows[0];
      checks.push(
        r.total < r.max * 0.8
          ? pass('pool-live', `${r.total} of ${r.max} connections in use`)
          : fail('pool-live', 'Connections below 80% of max_connections', `${r.total}/${r.max}`),
      );
      checks.push(
        r.idle_tx === 0
          ? pass('pool-idle-tx', 'No sessions stuck "idle in transaction"')
          : fail(
              'pool-idle-tx',
              'No sessions stuck "idle in transaction"',
              `${r.idle_tx} found: a transaction is holding a connection (see #46)`,
            ),
      );
      const sup = (
        await pg.query(
          `SELECT rolname FROM pg_roles WHERE rolname IN ('crm_app','crm_worker') AND (rolsuper OR rolbypassrls)`,
        )
      ).rows;
      checks.push(
        sup.length
          ? fail(
              'pool-role',
              'Runtime roles are neither superuser nor BYPASSRLS',
              sup.map((x) => x.rolname).join(','),
              [],
              'critical',
            )
          : pass('pool-role', 'Runtime roles are neither superuser nor BYPASSRLS'),
      );
      await pg.end();
    }
    return {
      checks,
      metrics: {
        'pool default': facts.poolDefault,
        'statement timeout ms': facts.stmtMs,
        'connection timeout ms': facts.connMs,
      },
      target: {
        met: null,
        text: 'Static budget checked. Tuning evidence (wait time, p95 under load) comes from #54 stress run with DATABASE_URL set.',
      },
    };
  },
};
