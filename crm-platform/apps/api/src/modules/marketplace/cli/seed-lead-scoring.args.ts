import {
  parseArgs as parseAppArgs,
  usage,
  type ParsedArgs,
  type SeedAppOptions,
} from './seed-app.args';
import { LEAD_SCORING_CONFIG } from './seed-app.config';

/** The `seed:lead-scoring` arguments: the shared rules (seed-app.args.ts) bound to the AI lead scoring configuration (999 INR monthly by default). */
export type SeedLeadScoringOptions = SeedAppOptions;
export const USAGE = usage(LEAD_SCORING_CONFIG);
export const parseArgs = (argv: readonly string[]): ParsedArgs =>
  parseAppArgs(argv, LEAD_SCORING_CONFIG);
