/* eslint-disable no-console -- command-line tool: console is its interface */
import 'reflect-metadata';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';

loadEnv({ path: resolve(__dirname, '../../../../../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

/**
 * Demo data for the store screens (dev only): about 12 products in 3 categories, 5 coupons, 14 customers and 30 orders over the last
 * 45 days, in one workspace, written through the real paths so the orders are linked to CRM contacts and the paid ones have sales
 * orders, invoices or receipts and ledger entries. Everything is tagged `store-demo` so it can be removed again.
 *
 *   pnpm --filter @crm/api seed:store-demo -- [--org <slug|id>] [--storefront <uuid>] [--seed <n>]   add what is missing (idempotent)
 *   pnpm --filter @crm/api seed:store-demo -- --reset  [same target]                                  delete exactly what the seed made
 *   pnpm --filter @crm/api seed:store-demo -- --fresh  [same target]                                  reset, then seed
 *   pnpm --filter @crm/api seed:store-demo -- --plan                                                  print the plan, write nothing
 *   (add --sql to see every query the app logs in development)
 *
 * The target is `--storefront` (its workspace and shop), else `--org` (its first shop, or a new "Demo Store"), else the first workspace
 * that has a shop. The script runs from a swc build of `src` (the app's dependency injection needs the compiler's decorator
 * metadata, which tsx does not emit) into `dist-cli`, so it never touches `dist` that a running dev server may be serving.
 *
 * It does not configure any payment gateway, does not publish order events (nothing is sent to the demo buyers) and refuses to run with
 * NODE_ENV=production. `--reset` and the date back-dating use MIGRATION_DATABASE_URL (the owner role) because the payment ledger and
 * issued invoices are frozen by triggers on purpose.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
/** The tool's own output. In a development environment the database layer logs every query to `console.log`: that is silenced (use `--sql` to see it). */
const say = (...args: unknown[]): void => {
  process.stdout.write(`${args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ')}
`);
};
if (!flag('sql')) console.log = () => undefined;

async function main(): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    console.error('refusing to seed demo data with NODE_ENV=production');
    return 1;
  }
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('MIGRATION_DATABASE_URL (or DATABASE_URL) is not set');
    return 1;
  }
  const seedArg = arg('seed');
  const seed = seedArg === undefined ? undefined : Number(seedArg);
  if (seed !== undefined && !Number.isInteger(seed)) {
    console.error('--seed takes an integer');
    return 1;
  }
  const owner = new Client({ connectionString: url });
  await owner.connect();
  try {
    // Imported after the environment is loaded and in the order the application loads them (a domain barrel first hits an import cycle).
    const { AppModule } = await import('../../../app.module');
    const seeder = await import('./demo-seeder');
    const plan = await import('./demo-plan');
    const log = (line: string) => say(line);

    const target = await seeder.resolveTarget(owner, {
      org: arg('org'),
      storefront: arg('storefront'),
      log,
    });
    if (!target) {
      console.error('no workspace or storefront found for that target');
      return 1;
    }
    say(
      `target: workspace "${target.orgSlug}" (id ${target.orgId}), storefront ${target.storefrontName ?? '(unnamed)'} ${target.storefrontUuid}`,
    );

    if (flag('plan')) {
      const p = await seeder.planFor(owner, target, { seed });
      say(JSON.stringify(plan.summarisePlan(p), null, 2));
      return 0;
    }
    if (flag('reset') || flag('fresh')) {
      const gone = await seeder.runReset(owner, target.orgId);
      say('reset: deleted', JSON.stringify(gone));
      if (!flag('fresh')) return 0;
    }

    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'],
    });
    try {
      const result = await seeder.runSeed(app, owner, target, { seed, log });
      say('created:', JSON.stringify(result.created));
      say('already there:', JSON.stringify(result.skipped));
      say('billing:', JSON.stringify(result.billing));
      say(
        'now in the workspace:',
        JSON.stringify(await seeder.countDemo(owner, target.orgId), null, 2),
      );
      for (const f of result.failures) console.error(`failure: ${f}`);
      return result.failures.length === 0 ? 0 : 1;
    } finally {
      await app.close();
    }
  } finally {
    await owner.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
