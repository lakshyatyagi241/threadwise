import {
  parseArgs as parseAppArgs,
  usage,
  type ParsedArgs,
  type SeedAppOptions,
} from './seed-app.args';
import { FORMS_CONFIG } from './seed-app.config';

/** The `seed:forms` arguments: the shared rules (seed-app.args.ts) bound to the Forms configuration (799 INR monthly by default). */
export type SeedFormsOptions = SeedAppOptions;
export const USAGE = usage(FORMS_CONFIG);
export const parseArgs = (argv: readonly string[]): ParsedArgs => parseAppArgs(argv, FORMS_CONFIG);
