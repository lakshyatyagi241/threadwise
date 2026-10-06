import { FORMS_CONFIG } from './seed-app.config';
import { exitWith, runSeedMain } from './seed-app.main';

/**
 * Local-development seed for the Forms Marketplace app (docs/specs/forms-builder-app.md, decision D1). The migration seeds the listing as
 * a draft with no price, so on a fresh database Forms is invisible and every Forms route answers PLAN_FEATURE_LOCKED until a platform
 * operator prices, publishes and comps it in the console. This does those steps through the same services:
 *
 *   pnpm --filter @crm/api build && pnpm --filter @crm/api seed:forms [-- --price 799 --currency INR --workspace <slug> --dry-run --force]
 *   pnpm --filter @crm/api seed:forms -- --all-workspaces --yes        (development only: comps every workspace)
 *
 * No workspace used Forms before it existed, so nobody is comped unless you name a workspace (or pass --all-workspaces). Same guards as
 * `seed:appointments`: local database only, never production, idempotent, never overwrites an operator's decision without `--force`.
 * See docs/runbooks/dev-seed-marketplace-apps.md.
 */
exitWith(runSeedMain(FORMS_CONFIG));
