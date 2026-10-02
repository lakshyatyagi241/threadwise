#!/usr/bin/env tsx
/* eslint-disable no-console -- command-line tool: console is its interface */
import 'reflect-metadata';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: resolve(__dirname, '../../../../../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

/**
 * TW-I18N-033, the port of Reference's `auto-reply:translate-existing`: translates every existing auto-reply keyword and
 * reply text into the owning workspace's target languages.
 *
 *   pnpm --filter @crm/api auto-reply:translate-existing [-- --workspace <slug>] [--force]
 *
 * Without `--force` only rules that have no translations yet are visited. The exit code is 1 when any rule failed.
 * `--workspace` takes the workspace slug (internal ids never leave the system).
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  // Imported late so the env file is loaded before the config module validates it.
  const { AppModule } = await import('../../../app.module');
  const { TenantDirectory } = await import('../../auth');
  const { KeywordTranslationService } = await import('../keyword-translation.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    let orgId: number | undefined;
    const slug = arg('workspace');
    if (slug) {
      const org = await app.get(TenantDirectory).findOrgBySlug(slug);
      if (!org) {
        console.error(`no workspace with the slug "${slug}"`);
        return 1;
      }
      orgId = org.id;
    }
    const result = await app.get(KeywordTranslationService).backfill({
      orgId,
      force: process.argv.includes('--force'),
      onRule: (rule, error) =>
        console.log(
          error ? `  failed: ${rule.keyword} (${error.message})` : `  translated: ${rule.keyword}`,
        ),
    });
    if (result.total === 0) {
      console.log(
        'Nothing to backfill: every rule is already translated. Use --force to translate again.',
      );
      return 0;
    }
    console.log(`Done. ${result.translated} translated, ${result.failed} failed.`);
    return result.failed === 0 ? 0 : 1;
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
