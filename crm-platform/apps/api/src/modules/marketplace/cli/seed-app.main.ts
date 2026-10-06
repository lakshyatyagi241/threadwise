/* eslint-disable no-console -- command-line tool: console is its interface */
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { checkGuards, parseArgs, usage } from './seed-app.args';
import type { SeedAppConfig } from './seed-app.config';

const say = (line = ''): void => {
  process.stdout.write(`${line}\n`);
};

/**
 * The command-line entry shared by `seed:appointments` and `seed:forms`: parse, guard, boot the application context, run, print the
 * before / after summary. Returns the process exit code. It runs from the build (like `auto-reply:translate-existing`), because the
 * application's dependency injection needs the compiler's decorator metadata, which `tsx` does not emit.
 */
export async function runSeedMain(config: SeedAppConfig): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2), config);
  if (parsed.kind === 'help') {
    say(usage(config));
    return 0;
  }
  if (parsed.kind === 'error') {
    console.error(`${parsed.message}\n\n${usage(config)}`);
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
  const { runSeedApp } = await import('./seed-app.runner');

  say(`${config.label} app seed${options.dryRun ? ' (dry run: nothing is written)' : ''}`);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const out = await runSeedApp(app, config, options, say);
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

/** Exit the process with the command's code; an unexpected error prints its message and exits 1. */
export function exitWith(run: Promise<number>): void {
  run.then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
