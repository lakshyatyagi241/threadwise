/* eslint-disable no-console -- command-line tool: console is its interface */
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { checkGuards, parseArgs, USAGE } from './seed-appointments.args';

/**
 * Local-development seed for the Appointments Marketplace app. The migration seeds the listing as a draft with no price and every plan
 * has `appointment_booking` off, so on a fresh database the app is invisible and booking is locked until a platform operator prices,
 * publishes and comps it in the console. This does those steps for you, through the same services, so a teammate's database matches the
 * owner's:
 *
 *   pnpm --filter @crm/api build && pnpm --filter @crm/api seed:appointments [-- --price 499 --currency INR --workspace <slug> --dry-run --force]
 *
 * It runs from the build (like `auto-reply:translate-existing`), because the application's dependency injection needs the compiler's
 * decorator metadata, which `tsx` does not emit. Local development only: it refuses NODE_ENV=production and any database that is not on
 * this machine. Idempotent; never overwrites an operator's price or published state without `--force`. See
 * docs/runbooks/dev-seed-appointments-app.md.
 */
const say = (line = ''): void => {
  process.stdout.write(`${line}\n`);
};

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.kind === 'help') {
    say(USAGE);
    return 0;
  }
  if (parsed.kind === 'error') {
    console.error(`${parsed.message}\n\n${USAGE}`);
    return 1;
  }
  const { options } = parsed;

  // The environment first (the application reads the same files), then the guards, and only then is anything connected.
  for (const file of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')])
    if (existsSync(file)) loadEnv({ path: file });
  const guard = checkGuards(process.env);
  if (!guard.ok) {
    console.error(guard.reason);
    return 1;
  }

  // The application logs every query with console.log in development: this tool's own output goes through `say`.
  console.log = () => undefined;

  // Imported after the environment is loaded and in the order the application loads them (a domain barrel first hits an import cycle).
  const { AppModule } = await import('../../../app.module');
  const { runSeedAppointments } = await import('./seed-appointments.runner');

  say(`Appointments app seed${options.dryRun ? ' (dry run: nothing is written)' : ''}`);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const out = await runSeedAppointments(app, options, say);
    const rows: Array<[string, keyof typeof out.before]> = [
      ['listing', 'status'],
      ['price', 'price'],
      ['add-on pack', 'pack'],
      ['version', 'version'],
      ['subscriptions', 'subscriptions'],
      ['plan visibility', 'visibility'],
    ];
    say();
    say('before');
    for (const [label, key] of rows) say(`  ${label.padEnd(16)}${out.before[key]}`);
    say(options.dryRun ? '\nwould change' : '\nchanged');
    if (out.actions.length === 0) say('  nothing to do');
    for (const a of out.actions) say(`  - ${a}`);
    if (out.notes.length > 0) {
      say('\nleft as is');
      for (const n of out.notes) say(`  - ${n}`);
    }
    if (!options.dryRun) {
      say('\nafter');
      for (const [label, key] of rows) say(`  ${label.padEnd(16)}${out.after[key]}`);
    }
    return 0;
  } finally {
    await app.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
