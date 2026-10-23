#!/usr/bin/env node
// Before/after measurement of the campaign recipients page (QA task 45).
//   node tools/pagination-audit/bench.mjs --db <scratch database> --out result.json [--rows 300000]
// Seeds one campaign with --rows recipients (and as many contacts) into a SCRATCH database, runs the page query as it was (BEFORE) and as it
// is now (AFTER) at several page depths under EXPLAIN ANALYZE, REPS times each, interleaved, and compares the rows they return.
// The two SQL texts are copies of campaigns.repository.ts `recipientsPage`; the repository spec and the row comparison here keep them honest.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const val = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const DB = val('--db');
const ROWS = Number(val('--rows', 300000));
const REPS = Number(val('--reps', 7));
if (!DB || !/^qa_[a-z0-9_]+$/.test(DB)) {
  console.error(
    'usage: bench.mjs --db qa_<scratch database> [--out file] [--rows N]   (only a qa_ scratch database is accepted)',
  );
  process.exit(2);
}
const psql = (sql, json = false) =>
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'crm-platform-postgres',
      'psql',
      '-U',
      'crm',
      '-d',
      DB,
      '-v',
      'ON_ERROR_STOP=1',
      '-tA',
      '-c',
      sql,
    ],
    { encoding: 'utf8', maxBuffer: 1 << 28 },
  ).trim();

const SELECT = `SELECT r.id, r.uuid, r.contact_id, c.uuid AS contact_uuid, r.variant, r.status, r.send_attempts, r.next_attempt_at,
  coalesce(nullif(r.phone_number, ''), CASE WHEN EXISTS (SELECT 1 FROM wpcampaigns w WHERE w.org_id = r.org_id AND w.id = r.campaign_id AND w.provider = 'email') THEN c.email::text ELSE c.phone END) AS phone_number,
  coalesce(nullif(r.recipient_name, ''), c.name) AS recipient_name, r.whatsapp_message_id, r.clicked, r.click_count, r.clicked_at, r.sent_at, r.delivered_at,
  r.read_at, r.responded_at, r.response, r.error_message, r.held_until, r.held_reason, r.created_at, r.updated_at
  FROM wp_campaign_contacts r LEFT JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id`;
const where = (cid, status) =>
  `r.org_id = 1 AND r.campaign_id = ${cid}${status ? ` AND r.status = '${status}'` : ''}`;
const before = (cid, status, off) =>
  `${SELECT} WHERE ${where(cid, status)} ORDER BY r.id DESC LIMIT 50 OFFSET ${off}`;
const after = (cid, status, off) =>
  `${SELECT} WHERE r.org_id = 1 AND r.id IN (SELECT r.id FROM wp_campaign_contacts r WHERE ${where(cid, status)} ORDER BY r.id DESC LIMIT 50 OFFSET ${off}) ORDER BY r.id DESC`;

const timeOf = (q) => {
  const j = JSON.parse(psql(`EXPLAIN (ANALYZE, FORMAT JSON) ${q}`));
  return j[0]['Execution Time'];
};
const idsOf = (q) => psql(`SELECT string_agg(id::text, ',') FROM (${q}) t`);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

console.log(`seeding ${ROWS} recipients into ${DB}`);
psql(`INSERT INTO wpcampaigns (org_id, campaign_name) VALUES (1, 'pagination bench')`);
const cid = Number(psql(`SELECT max(id) FROM wpcampaigns WHERE org_id = 1`));
psql(
  `INSERT INTO contacts (org_id, name, phone) SELECT 1, 'Bench ' || g, '9199' || lpad(g::text, 8, '0') FROM generate_series(1, ${ROWS}) g`,
);
psql(`INSERT INTO wp_campaign_contacts (org_id, campaign_id, contact_id, status, phone_number, recipient_name)
  SELECT 1, ${cid}, c.id, (ARRAY['queued','sent','delivered','read','failed'])[1 + (c.id % 5)::int], c.phone, c.name FROM contacts c WHERE c.org_id = 1 AND c.name LIKE 'Bench %'`);
psql('ANALYZE wp_campaign_contacts; ANALYZE contacts;');

const depths = [0, 1000, 50000, 150000, Math.max(0, ROWS - 100)];
const cases = [];
for (const status of [undefined, 'delivered']) {
  for (const off of depths) {
    const b = [];
    const a = [];
    for (let i = 0; i < REPS; i++) {
      b.push(timeOf(before(cid, status, off)));
      a.push(timeOf(after(cid, status, off)));
    }
    const same = idsOf(before(cid, status, off)) === idsOf(after(cid, status, off));
    const row = {
      filter: status ?? 'none',
      offset: off,
      beforeMs: +median(b).toFixed(1),
      afterMs: +median(a).toFixed(1),
      sameRows: same,
    };
    row.speedup = +(row.beforeMs / Math.max(row.afterMs, 0.01)).toFixed(1);
    cases.push(row);
    console.log(
      `filter ${row.filter.padEnd(9)} offset ${String(off).padStart(7)}: before ${row.beforeMs} ms, after ${row.afterMs} ms (x${row.speedup}), same rows ${same}`,
    );
  }
}
const out = { rows: ROWS, reps: REPS, measuredAt: new Date().toISOString(), cases };
if (val('--out')) writeFileSync(val('--out'), JSON.stringify(out, null, 2) + '\n');
const deep = cases.filter((c) => c.offset >= 50000);
const bad = [
  ...cases.filter((c) => !c.sameRows).map((c) => `different rows at offset ${c.offset}`),
  ...deep
    .filter((c) => c.speedup < 2)
    .map((c) => `only x${c.speedup} at offset ${c.offset} (filter ${c.filter})`),
];
if (bad.length) {
  console.error(`bench FAIL: ${bad.join('; ')}`);
  process.exit(1);
}
console.log(
  `bench PASS: same rows everywhere; deep pages ${Math.min(...deep.map((c) => c.speedup))}x faster or more`,
);
