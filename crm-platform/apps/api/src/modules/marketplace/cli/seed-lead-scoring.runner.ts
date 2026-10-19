import type { INestApplicationContext } from '@nestjs/common';
import { LEAD_SCORING_CONFIG } from './seed-app.config';
import { runSeedApp, type SeedOutcome } from './seed-app.runner';
import type { SeedLeadScoringOptions } from './seed-lead-scoring.args';

/** The `seed:lead-scoring` run: the shared guarded steps (seed-app.runner.ts) with the AI lead scoring configuration. */
export const runSeedLeadScoring = (
  app: INestApplicationContext,
  opts: SeedLeadScoringOptions,
  say: (line: string) => void = () => undefined,
): Promise<SeedOutcome> => runSeedApp(app, LEAD_SCORING_CONFIG, opts, say);
