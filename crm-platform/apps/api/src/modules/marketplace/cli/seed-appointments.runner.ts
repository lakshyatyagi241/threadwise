import type { INestApplicationContext } from '@nestjs/common';
import { APPOINTMENTS_CONFIG } from './seed-app.config';
import { runSeedApp, type SeedOutcome } from './seed-app.runner';
import type { SeedAppointmentsOptions } from './seed-appointments.args';

/** The `seed:appointments` run: the shared guarded steps (seed-app.runner.ts) with the Appointments configuration. */
export { priceLabel, snapshot, type Snapshot, type SeedOutcome } from './seed-app.runner';

export const APP_SLUG = APPOINTMENTS_CONFIG.slug;
export const GRANTED_FEATURE = APPOINTMENTS_CONFIG.feature;

export const runSeedAppointments = (
  app: INestApplicationContext,
  opts: SeedAppointmentsOptions,
  say: (line: string) => void = () => undefined,
): Promise<SeedOutcome> => runSeedApp(app, APPOINTMENTS_CONFIG, opts, say);
