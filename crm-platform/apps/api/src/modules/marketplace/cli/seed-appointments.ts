import { APPOINTMENTS_CONFIG } from './seed-app.config';
import { exitWith, runSeedMain } from './seed-app.main';

/**
 * Local-development seed for the Appointments Marketplace app. The migration seeds the listing as a draft with no price and every plan
 * has `appointment_booking` off, so on a fresh database the app is invisible and booking is locked until a platform operator prices,
 * publishes and comps it in the console. This does those steps for you, through the same services, so a teammate's database matches the
 * owner's:
 *
 *   pnpm --filter @crm/api build && pnpm --filter @crm/api seed:appointments [-- --price 499 --currency INR --workspace <slug> --dry-run --force]
 *
 * Local development only: it refuses NODE_ENV=production and any database that is not on this machine. Idempotent; never overwrites an
 * operator's price or published state without `--force`. The shared steps are in seed-app.runner.ts (also used by `seed:forms`). See
 * docs/runbooks/dev-seed-marketplace-apps.md.
 */
exitWith(runSeedMain(APPOINTMENTS_CONFIG));
