import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { validateEnv, type Env } from './env.schema';

/** Injectable, fully typed. `config.get('DATABASE_URL')` is checked at compile time. */
export type AppConfigService = ConfigService<Env, true>;

/**
 * Finds the repo-root .env by walking up from this file.
 *
 * A fixed relative path breaks the moment the compiled layout changes
 * (`src/config` is two levels deep in source, three in `dist/src/config`), and
 * the failure shows up as "DATABASE_URL: Required" at boot, which sends you
 * looking at the wrong thing. Walking up is immune to that.
 *
 * In production nothing is read from a file at all — the environment is
 * injected by the orchestrator, and a missing .env is normal.
 */
function findEnvFiles(): string[] {
  const candidates: string[] = [];
  let dir = __dirname;

  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) candidates.push(candidate);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const fromCwd = resolve(process.cwd(), '.env');
  if (existsSync(fromCwd) && !candidates.includes(fromCwd)) candidates.push(fromCwd);

  return candidates;
}

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: findEnvFiles(),
      validate: validateEnv,
    }),
  ],
  exports: [NestConfigModule],
})
export class AppConfigModule {}
