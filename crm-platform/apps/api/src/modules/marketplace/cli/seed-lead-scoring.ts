import { LEAD_SCORING_CONFIG } from './seed-app.config';
import { exitWith, runSeedMain } from './seed-app.main';

/**
 * Local-development seed for the AI lead scoring Marketplace app. The migration seeds the listing as a draft with no price, so on a fresh
 * database the app is invisible and every lead scoring route answers PLAN_FEATURE_LOCKED until a platform operator prices, publishes and comps
 * it in the console. This does those steps through the same services:
 *
 *   pnpm --filter @crm/api build && pnpm --filter @crm/api seed:lead-scoring [-- --price 999 --currency INR --workspace <slug> --dry-run --force]
 *   pnpm --filter @crm/api seed:lead-scoring -- --all-workspaces --yes        (development only: comps every workspace)
 *
 * A workspace that already used scoring was given an override by the migration, and is comped here as well. Same guards as `seed:appointments`:
 * local database only, never production, idempotent, never overwrites an operator's decision without `--force`.
 * See docs/runbooks/dev-seed-marketplace-apps.md.
 */
exitWith(runSeedMain(LEAD_SCORING_CONFIG));
