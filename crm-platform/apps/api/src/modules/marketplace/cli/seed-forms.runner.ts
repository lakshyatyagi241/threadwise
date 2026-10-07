import type { INestApplicationContext } from '@nestjs/common';
import { FORMS_CONFIG } from './seed-app.config';
import { runSeedApp, type SeedOutcome } from './seed-app.runner';
import type { SeedFormsOptions } from './seed-forms.args';

/** The `seed:forms` run: the shared guarded steps (seed-app.runner.ts) with the Forms configuration. */
export const runSeedForms = (
  app: INestApplicationContext,
  opts: SeedFormsOptions,
  say: (line: string) => void = () => undefined,
): Promise<SeedOutcome> => runSeedApp(app, FORMS_CONFIG, opts, say);
