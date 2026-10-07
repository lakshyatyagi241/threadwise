import {
  parseArgs as parseAppArgs,
  usage,
  type ParsedArgs,
  type SeedAppOptions,
} from './seed-app.args';
import { APPOINTMENTS_CONFIG } from './seed-app.config';

/** The `seed:appointments` arguments: the shared rules (seed-app.args.ts) bound to the Appointments configuration. */
export { checkGuards, hostsOfDatabaseUrl, isLocalHost } from './seed-app.args';
export type { ParsedArgs } from './seed-app.args';

export type SeedAppointmentsOptions = SeedAppOptions;
export const DEFAULT_PRICE = APPOINTMENTS_CONFIG.defaultPrice;
export const DEFAULT_CURRENCY = APPOINTMENTS_CONFIG.defaultCurrency;
export const USAGE = usage(APPOINTMENTS_CONFIG);
export const parseArgs = (argv: readonly string[]): ParsedArgs =>
  parseAppArgs(argv, APPOINTMENTS_CONFIG);
