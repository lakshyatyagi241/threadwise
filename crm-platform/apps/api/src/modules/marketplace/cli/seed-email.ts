import { EMAIL_CONFIG } from './seed-app.config';
import { exitWith, runSeedMain } from './seed-app.main';

/**
 * Local-development seed for the Email (Gmail) Marketplace app (docs/threadwise-port/plan/channel-email-build.md). The migration seeds the
 * listing as a draft with no price, so on a fresh database Email is invisible and every Email route answers PLAN_FEATURE_LOCKED until a
 * platform operator prices, publishes and comps it in the console. This does those steps through the same services:
 *
 *   pnpm --filter @crm/api build && pnpm --filter @crm/api seed:email [-- --price 499 --currency INR --workspace <slug> --dry-run --force]
 *   pnpm --filter @crm/api seed:email -- --all-workspaces --yes        (development only: comps every workspace)
 *
 * No workspace used the Gmail channel before it existed, so nobody is comped unless you name a workspace (or pass --all-workspaces). Same
 * guards as `seed:forms`: local database only, never production, idempotent, never overwrites an operator's decision without `--force`.
 * See docs/runbooks/dev-seed-marketplace-apps.md and docs/runbooks/email-addon-operator-setup.md.
 */
exitWith(runSeedMain(EMAIL_CONFIG));
