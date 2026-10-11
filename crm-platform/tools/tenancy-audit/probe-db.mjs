import { writeFileSync, mkdirSync } from 'node:fs';
import { runDbProbe } from './lib/db-probe.mjs';

const ownerUrl = process.env.MIGRATION_DATABASE_URL;
const appUrl = process.env.TENANCY_APP_DATABASE_URL;
if (!ownerUrl || !appUrl)
  throw new Error(
    'set MIGRATION_DATABASE_URL (owner) and TENANCY_APP_DATABASE_URL (restricted app role)',
  );

const res = await runDbProbe({ ownerUrl, appUrl, log: console.log });
mkdirSync('reports/tenancy-audit', { recursive: true });
writeFileSync('reports/tenancy-audit/db-probe-results.json', JSON.stringify(res, null, 1));
const by = {};
for (const r of res) by[r.status] = (by[r.status] ?? 0) + 1;
console.log(by);
for (const r of res.filter((x) => x.status === 'FAILED'))
  console.log('FAILED', r.table, r.scenario, r.detail);
