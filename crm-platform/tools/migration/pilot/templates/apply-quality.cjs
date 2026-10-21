#!/usr/bin/env node
'use strict';
/**
 * Server side of the template-quality step (cycle.cjs template-quality). Writes the ratings the runner read from Meta (quality.cjs) into
 * the workspace's migrated templates: a template is touched only when it exists and its rating differs. The input holds names, languages
 * and ratings, no secrets. Runs in the desk-api image (it has `pg`) with the app's worker login, not a superuser.
 *
 *   node apply-quality.cjs --org-slug <slug> --client <waboo client> --input <file> [--apply]
 *
 * Without --apply it counts what would change and rolls back. Needs TARGET_DATABASE_URL.
 */
const fs = require('node:fs');

const LEVELS = new Set(['GREEN', 'YELLOW', 'RED', 'UNKNOWN']);

function args(argv) {
  const get = (k) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    slug: get('org-slug'),
    client: get('client'),
    input: get('input'),
    apply: argv.includes('--apply'),
  };
}

async function main(argv) {
  const a = args(argv);
  if (!a.slug || !a.client || !a.input || !process.env.TARGET_DATABASE_URL)
    throw new Error('usage: apply-quality.cjs --org-slug <slug> --client <c> --input <file> [--apply] (TARGET_DATABASE_URL set)');
  const input = JSON.parse(fs.readFileSync(a.input, 'utf8'));
  if (input.client !== a.client) throw new Error('the ratings file is for another client');
  const rows = (Array.isArray(input.rows) ? input.rows : []).filter(
    (r) => r && typeof r.name === 'string' && typeof r.language === 'string' && LEVELS.has(r.quality),
  );

  const { Client } = require('pg');
  const db = new Client({
    connectionString: process.env.TARGET_DATABASE_URL,
    application_name: 'waboo-template-quality',
    connectionTimeoutMillis: 10000,
  });
  await db.connect();
  try {
    const me = (
      await db.query('SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user')
    ).rows[0];
    if (me.rolsuper || me.rolbypassrls)
      throw new Error('this login bypasses row-level security: use the crm_worker_user login');

    await db.query('BEGIN');
    let changed = 0;
    let matched = 0;
    try {
      // the migrated organization: slug matches AND it carries the marker of THIS client (as the credential import checks)
      const org = (
        await db.query(
          `SELECT id FROM organizations WHERE slug = $1 AND settings #>> '{legacy,waboo,client}' = $2`,
          [a.slug, a.client],
        )
      ).rows;
      if (org.length !== 1) throw new Error(`no migrated organization ${a.slug} for client ${a.client}`);
      const orgId = org[0].id;
      await db.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
      await db.query(`SELECT set_config('app.user_id', '', true)`);
      for (const r of rows) {
        const res = await db.query(
          `UPDATE wa_templates SET quality_score = $3
             WHERE org_id = $1 AND template_name = $2 AND language = $4 AND quality_score IS DISTINCT FROM $3`,
          [orgId, r.name, r.quality, r.language],
        );
        changed += res.rowCount;
        const seen = await db.query(
          'SELECT count(*)::int AS n FROM wa_templates WHERE org_id = $1 AND template_name = $2 AND language = $3',
          [orgId, r.name, r.language],
        );
        matched += seen.rows[0].n;
      }
      await db.query(a.apply ? 'COMMIT' : 'ROLLBACK');
    } catch (e) {
      await db.query('ROLLBACK').catch(() => undefined);
      throw e;
    }
    console.log(
      `template-quality: ${rows.length} rating(s) read, ${matched} migrated template(s) matched, ${changed} rating(s) ${a.apply ? 'written' : 'would change (dry run, nothing written)'}`,
    );
  } finally {
    await db.end().catch(() => undefined);
  }
}

module.exports = { args };

if (require.main === module)
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
