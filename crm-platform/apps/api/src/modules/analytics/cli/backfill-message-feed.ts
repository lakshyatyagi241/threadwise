import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

loadEnv({ path: resolve(__dirname, '../../../../../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

/**
 * Rebuilds the base message rollups (metrics MSG_FEED_BASE and CONV_REPLY_BASE) from `messages`, for the messages created before the
 * cut-over (docs/superpowers/specs/2026-10-19-message-count-rollup-design.md, section 8). Run once per environment before
 * `ANALYTICS_SOURCES` gets `msg_feed`, and again for a range after importing history with old creation times. Repeatable: a run replaces
 * the rows of its range and gives the same rows again. Messages created after the cut-over come from events and are never touched.
 *
 *   pnpm --filter @crm/api backfill:message-feed -- [--org <slug|id>] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *
 * Default: every workspace, from its first message to the cut-over. One workspace and one calendar month per statement, so a statement
 * stays short and a failure is reported for its workspace and month and never stops the run. Refuses NODE_ENV=production unless
 * `--allow-production` is given.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const say = (s: string): void => {
  process.stdout.write(`${s}\n`);
};

async function main(): Promise<number> {
  if (process.env.NODE_ENV === 'production' && !flag('allow-production')) {
    console.error('refusing to run with NODE_ENV=production (pass --allow-production to override)');
    return 1;
  }
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('MIGRATION_DATABASE_URL (or DATABASE_URL) is not set');
    return 1;
  }
  const from = arg('from');
  const to = arg('to');
  for (const [name, v] of [
    ['from', from],
    ['to', to],
  ] as const) {
    if (flag(name) && (v === undefined || !DAY.test(v))) {
      console.error(`--${name} takes a date, YYYY-MM-DD`);
      return 1;
    }
  }
  const org = arg('org');
  if (flag('org') && !org) {
    console.error('--org takes a workspace slug or id');
    return 1;
  }

  const db = new Client({ connectionString: url });
  await db.connect();
  let failed = 0;
  try {
    const orgs = await db.query(
      `SELECT id, slug FROM organizations
        WHERE ($1::text IS NULL OR slug = $1 OR id::text = $1) ORDER BY id`,
      [org ?? null],
    );
    if (orgs.rows.length === 0) {
      console.error(`no workspace "${org ?? ''}"`);
      return 1;
    }
    const cutover = new Date((await db.query('SELECT an_msg_feed_cutover() AS c')).rows[0].c);
    for (const o of orgs.rows as Array<{ id: string; slug: string }>) {
      const first = (
        await db.query('SELECT min(created_at) AS t FROM messages WHERE org_id = $1', [o.id])
      ).rows[0].t as Date | null;
      const start = from ? new Date(`${from}T00:00:00Z`) : first;
      if (!start) continue;
      const end = to ? new Date(`${to}T00:00:00Z`) : cutover;
      // month by month, from a day before the first month starts to be safe in any zone; the function clamps to the cut-over and rounds to local days
      for (let m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); m < end;) {
        const next = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
        try {
          await db.query('SELECT an_msg_feed_rebuild_base($1, $2, $3)', [o.id, m, next]);
          say(`${o.slug} ${m.toISOString().slice(0, 7)} done`);
        } catch (err) {
          failed++;
          console.error(`${o.slug} ${m.toISOString().slice(0, 7)} failed: ${String(err)}`);
        }
        m = next;
      }
    }
  } finally {
    await db.end();
  }
  return failed === 0 ? 0 : 2;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
