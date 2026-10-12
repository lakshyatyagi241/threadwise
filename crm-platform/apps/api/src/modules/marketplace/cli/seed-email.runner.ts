import type { INestApplicationContext } from '@nestjs/common';
import { EMAIL_CONFIG } from './seed-app.config';
import { runSeedApp, type SeedOutcome } from './seed-app.runner';
import type { SeedEmailOptions } from './seed-email.args';

/** The `seed:email` run: the shared guarded steps (seed-app.runner.ts) with the Email configuration. */
export const runSeedEmail = (
  app: INestApplicationContext,
  opts: SeedEmailOptions,
  say: (line: string) => void = () => undefined,
): Promise<SeedOutcome> => runSeedApp(app, EMAIL_CONFIG, opts, say);
