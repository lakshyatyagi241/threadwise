/* eslint-disable no-console -- command-line tool: console is its interface */
import 'reflect-metadata';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';

loadEnv({ path: resolve(__dirname, '../../../../../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

/**
 * Catch-up for store orders without a CRM contact (orders placed before the contact link existed, or refused a contact at the time):
 * links each to its contact (found or created by phone, source "store"), runs the same sync a new order gets (sales order, timeline
 * entry, an invoice or receipt only when the workspace's trigger is met: an unpaid order gets none) and saves the buyer's customer
 * profile when it is missing. Repeatable: a second run changes nothing.
 *
 *   pnpm --filter @crm/api backfill:store-orders -- [--org <slug|id>] [--dry-run]
 *   (add --sql to see every query the app logs in development)
 *
 * Default: every workspace. A plan out of contacts, a number that cannot be read (no default country for a bare local number) or an
 * error is reported per order and never stops the run. `--dry-run` writes nothing. Like the demo seeder it runs from a swc build of
 * `src` into `dist-cli`, so a running dev server's `dist` is never touched, and it refuses to run with NODE_ENV=production unless
 * `--allow-production` is given.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const say = (...args: unknown[]): void => {
  process.stdout.write(`${args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ')}\n`);
};
if (!flag('sql')) console.log = () => undefined;

async function resolveOrg(owner: Client, ref: string): Promise<number | undefined> {
  const res = /^\d+$/.test(ref)
    ? await owner.query('SELECT id FROM organizations WHERE id = $1::bigint OR slug = $2', [
        ref,
        ref,
      ])
    : await owner.query('SELECT id FROM organizations WHERE slug = $1', [ref]);
  return res.rows[0] ? Number(res.rows[0].id) : undefined;
}

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
  let orgId: number | undefined;
  const orgRef = arg('org');
  if (flag('org') && !orgRef) {
    console.error('--org takes a workspace slug or id');
    return 1;
  }
  if (orgRef) {
    const owner = new Client({ connectionString: url });
    await owner.connect();
    try {
      orgId = await resolveOrg(owner, orgRef);
    } finally {
      await owner.end();
    }
    if (orgId === undefined) {
      console.error(`no workspace "${orgRef}"`);
      return 1;
    }
  }

  // Imported after the environment is loaded and in the order the application loads them (a domain barrel first hits an import cycle).
  const { AppModule } = await import('../../../app.module');
  const { StoreOrderBackfillService } = await import('../store-order-backfill.service');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const backfill = app.get(StoreOrderBackfillService, { strict: false });
    const dryRun = flag('dry-run');
    say(dryRun ? 'DRY RUN: nothing is written' : 'backfilling store orders');
    const s = await backfill.run({ orgId, dryRun, log: say });
    say('');
    say(`summary${dryRun ? ' (dry run, predicted)' : ''}:`);
    say(`  orders without a contact scanned: ${s.scanned}`);
    say(`  linked to a contact:              ${s.linked}`);
    say(`    contacts created:               ${s.contactsCreated}`);
    say(`    existing contacts reused:       ${s.contactsFound}`);
    say(`  sales orders created:             ${s.salesOrdersCreated}`);
    say(`  invoices / receipts created:      ${s.invoicesCreated}`);
    say(`  payments recorded:                ${s.paymentsRecorded}`);
    say(`  customer profiles created:        ${s.profilesCreated}`);
    say(
      `  skipped:                          ${s.skipped.length} ${JSON.stringify(s.skippedByReason)}`,
    );
    for (const k of s.skipped) {
      say(
        `    order ${k.orderId} (workspace ${k.orgId}): ${k.reason}${k.detail ? ` (${k.detail})` : ''}`,
      );
    }
    return s.skippedByReason.error ? 1 : 0;
  } finally {
    await app.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
