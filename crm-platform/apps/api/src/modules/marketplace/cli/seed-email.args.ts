import {
  parseArgs as parseAppArgs,
  usage,
  type ParsedArgs,
  type SeedAppOptions,
} from './seed-app.args';
import { EMAIL_CONFIG } from './seed-app.config';

/** The `seed:email` arguments: the shared rules (seed-app.args.ts) bound to the Email configuration (499 INR monthly by default). */
export type SeedEmailOptions = SeedAppOptions;
export const USAGE = usage(EMAIL_CONFIG);
export const parseArgs = (argv: readonly string[]): ParsedArgs => parseAppArgs(argv, EMAIL_CONFIG);
