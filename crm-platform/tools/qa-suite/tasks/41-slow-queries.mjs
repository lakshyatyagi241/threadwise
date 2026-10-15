// #41 Slow-query analysis: the database can record slow statements (config), and every statement over the threshold is captured and ranked (live).
import {
  ROOT,
  expectNone,
  fail,
  pass,
  pgClient,
  read,
  skip,
  walk,
  warn,
  env,
} from '../lib/core.mjs';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const THRESHOLD = Number(process.env.QA_SLOW_MS ?? 100);

export default {
  id: 41,
  priority: 'P1',
  name: 'Slow-query analysis',
  owner: 'Punya',
  target: '100% queries over threshold captured; critical p95 DB time <100ms where feasible',
  async run() {
    const checks = [];
    const compose = [...walk(ROOT, (p) => /docker-compose[^/]*\.ya?ml$/.test(p))].map((f) => [
      f,
      read(f),
    ]);
    for (const [f, y] of compose) {
      const rel = f.replace(ROOT + '/', '');
      const log = +(y.match(/log_min_duration_statement=(-?\d+)/)?.[1] ?? NaN);
      if (!/postgres/.test(y)) continue;
      checks.push(
        log >= 0 && log <= THRESHOLD * 5
          ? pass(
              `slow-log-${rel}`,
              `${rel}: statements slower than ${log} ms are logged`,
              log > THRESHOLD
                ? `Threshold is ${THRESHOLD} ms for this task, so queries between ${THRESHOLD} and ${log} ms are NOT captured in the log; pg_stat_statements covers them.`
                : '',
            )
          : fail(
              `slow-log-${rel}`,
              `${rel}: log_min_duration_statement is set`,
              `found ${Number.isNaN(log) ? 'nothing' : log}`,
              [],
              'medium',
            ),
      );
      const pss = /shared_preload_libraries=[^\n]*pg_stat_statements/.test(
        y.replace(/\s+-c\s+/g, '\n'),
      );
      checks.push(
        pss
          ? pass(`slow-pss-${rel}`, `${rel}: pg_stat_statements is preloaded`)
          : fail(
              `slow-pss-${rel}`,
              `${rel}: pg_stat_statements is preloaded (per-statement time, calls, rows)`,
              'Without it there is no ranking by total time or p95: only the log, which has no statistics. Add -c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track=all and CREATE EXTENSION pg_stat_statements.',
              [],
              'medium',
            ),
      );
      checks.push(
        /auto_explain/.test(y)
          ? pass(
              `slow-autoexplain-${rel}`,
              `${rel}: auto_explain captures plans of slow statements`,
            )
          : warn(
              `slow-autoexplain-${rel}`,
              `${rel}: auto_explain captures plans of slow statements`,
              'Optional: shared_preload_libraries=pg_stat_statements,auto_explain with auto_explain.log_min_duration set to the threshold.',
            ),
      );
    }

    // log file (QA_PG_LOG=/path/to/postgresql.log): every "duration: N ms" line over the threshold
    const logPath = process.env.QA_PG_LOG;
    let logged = null;
    if (logPath && existsSync(logPath)) {
      const slow = [
        ...readFileSync(logPath, 'utf8').matchAll(
          /duration: ([\d.]+) ms\s+(?:statement|execute [^:]*):\s*(.{0,160})/g,
        ),
      ]
        .map((m) => ({ ms: +m[1], q: m[2] }))
        .filter((x) => x.ms >= THRESHOLD)
        .sort((a, b) => b.ms - a.ms);
      logged = slow.length;
      checks.push(
        expectNone(
          'slow-logfile',
          `No logged statement over ${THRESHOLD} ms (${slow.length} found in ${logPath})`,
          slow.slice(0, 30).map((x) => `${x.ms} ms  ${x.q}`),
          { level: 'warn' },
        ),
      );
    } else
      checks.push(
        skip(
          'slow-logfile',
          'Parse the Postgres log for statements over the threshold',
          'set QA_PG_LOG to the server log file',
        ),
      );

    const { client, error } = await pgClient();
    let top = [];
    if (!client)
      checks.push(
        skip('slow-live', 'Rank statements by total and mean time (pg_stat_statements)', error),
      );
    else {
      const ext = (
        await client.query(`SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements'`)
      ).rowCount;
      if (!ext)
        checks.push(
          fail(
            'slow-live',
            'pg_stat_statements is installed in this database',
            'CREATE EXTENSION pg_stat_statements (and preload it) to capture every statement.',
            [],
            'medium',
          ),
        );
      else {
        top = (
          await client.query(`SELECT left(regexp_replace(query, '\\s+', ' ', 'g'), 140) q, calls::int, round(mean_exec_time::numeric,1)::float mean, round(stddev_exec_time::numeric,1)::float sd,
              round(max_exec_time::numeric,1)::float max, round(total_exec_time::numeric,0)::float total
            FROM pg_stat_statements WHERE query !~* 'pg_stat_statements|pg_catalog|^(BEGIN|COMMIT|ROLLBACK|SET|SHOW)' ORDER BY total_exec_time DESC LIMIT 200`)
        ).rows;
        const est = (r) => r.mean + 1.645 * r.sd; // normal approximation: pg_stat_statements keeps no histogram, so this is an estimate
        const over = top.filter((r) => est(r) > THRESHOLD && r.calls >= 5);
        checks.push(
          expectNone(
            'slow-p95',
            `Statements with estimated p95 over ${THRESHOLD} ms (mean + 1.645 sd; >=5 calls)`,
            over
              .slice(0, 30)
              .map(
                (r) =>
                  `~${est(r).toFixed(0)}ms p95, mean ${r.mean}, max ${r.max}, ${r.calls} calls: ${r.q}`,
              ),
            { level: 'warn' },
          ),
        );
        checks.push(
          pass(
            'slow-captured',
            `${top.length} statements captured and ranked by total time`,
            'Top 5: ' +
              top
                .slice(0, 5)
                .map((r) => `${r.total}ms ${r.q.slice(0, 50)}`)
                .join(' | '),
          ),
        );
        if (process.argv.includes('--reset-stats'))
          await client.query('SELECT pg_stat_statements_reset()');
      }
      await client.end();
    }
    return {
      checks,
      metrics: {
        'threshold ms': THRESHOLD,
        'statements ranked': top.length,
        'in log over threshold': logged ?? 'n/a',
      },
      target: {
        met: checks.some((c) => c.status === 'fail') ? false : null,
        text: 'Capture needs pg_stat_statements; p95 comes from a run under load (run #54 first, then this).',
      },
    };
  },
};
