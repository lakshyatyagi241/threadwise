import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ERROR_CODES, PLAN_UPGRADE_PATH, TRIAL_EXPIRED_MESSAGE } from '@crm/contracts';
import { IS_PUBLIC_KEY } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { PlanEntitlementService } from './plan-entitlement.service';
import { setCapped } from '../../common/cache/capped-map';

export const ALLOW_WHEN_TRIAL_EXPIRED_KEY = 'plan:allow-when-trial-expired';

/** A route a workspace whose free trial has ended may still call (the plan picker, checkout, sign-out). */
export const AllowWhenTrialExpired = () => SetMetadata(ALLOW_WHEN_TRIAL_EXPIRED_KEY, true);

/**
 * Route groups that stay open after the trial ends (TW-PLAN-015 rule 2). Reference matched route NAMES (`account*`, `*checkout*`,
 * `*payment*`, `*invoice*`, `*support*`, `register*`, `verification*`, `*workspaces*`, `logout`); the names do not exist here, so the
 * first path segment of the versioned URL stands in for them, plus what the app shell needs to draw the recovery screen.
 *   billing, plans, payments   the plan picker, checkout, order history
 *   auth, account, onboarding  sign-in/out, workspace switching, the account hub, verification
 *   support                    the support desk
 *   me, i18n, shell            language and navigation, so the page that tells the user can render
 */
export const TRIAL_OPEN_SEGMENTS: ReadonlySet<string> = new Set([
  'billing',
  'plans',
  'payments',
  'auth',
  'account',
  'onboarding',
  'support',
  'me',
  'i18n',
  'shell',
  'setup',
  'health',
]);

/** The first path segment after an optional `/api` prefix and the version (`/v2/billing/plans` -> `billing`). */
export function firstSegment(url: string): string | null {
  const path = url.split('?')[0] ?? '';
  const m = /^\/(?:api\/)?(?:v\d+\/)?([^/]+)/.exec(path);
  return m?.[1] ?? null;
}

const GATED_ACTORS = new Set(['user', 'api_key']);
/**
 * How long a "not expired" verdict is reused, so the gate costs one lookup per workspace per few seconds, not one per request.
 * An "expired" verdict is never cached: a workspace that has just paid (or been given a plan by the operator) is let through on
 * its very next request.
 */
const OPEN_VERDICT_TTL_MS = 5_000;
/** At most this many workspaces' "not expired" verdicts are remembered per process; the oldest goes first. */
export const TRIAL_VERDICT_CACHE_MAX = 5_000;

/**
 * The trial hard gate (TW-PLAN-015): once a free trial has run out every feature route answers 402 until a plan is bought, while
 * billing, account, support and sign-in stay reachable. Runs after authentication, so the request context is populated.
 *
 *   - platform operators are never gated (a different actor pool)
 *   - Reference left the public REST API and the mobile API outside the gate (QUIRK); here API keys are gated too
 *   - the allow-list is route metadata (`@AllowWhenTrialExpired()`) plus `TRIAL_OPEN_SEGMENTS`
 *   - it fails OPEN on an internal error (the entitlement read throws) but not on missing data
 */
@Injectable()
export class TrialGateGuard implements CanActivate {
  private readonly logger = new Logger(TrialGateGuard.name);
  private readonly openUntil = new Map<number, number>();

  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_TRIAL_EXPIRED_KEY, targets))
      return true;

    const ctx = RequestContextStore.peek();
    if (!ctx || !GATED_ACTORS.has(ctx.actorType) || !(ctx.orgId > 0)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const segment = firstSegment(req.originalUrl ?? req.url ?? '');
    if (segment && TRIAL_OPEN_SEGMENTS.has(segment)) return true;

    if (await this.trialExpired(ctx.orgId)) {
      throw new AppError(
        ERROR_CODES.PLAN_TRIAL_EXPIRED,
        TRIAL_EXPIRED_MESSAGE,
        HttpStatus.PAYMENT_REQUIRED,
        [
          { path: 'upgradeUrl', message: PLAN_UPGRADE_PATH },
          { path: 'trial', message: 'expired' },
        ],
      );
    }
    return true;
  }

  private async trialExpired(orgId: number): Promise<boolean> {
    const now = Date.now();
    if ((this.openUntil.get(orgId) ?? 0) > now) return false;
    try {
      const e = await this.entitlements.forOrg(orgId);
      // Organizations the platform owns are never limited; a missing organization has nothing to gate.
      const expired = !!e && !e.platformOwned && e.state === 'free_trial_expired';
      if (!expired) setCapped(this.openUntil, orgId, now + OPEN_VERDICT_TTL_MS, TRIAL_VERDICT_CACHE_MAX);
      return expired;
    } catch (err) {
      this.logger.warn(
        { err, orgId },
        'trial gate could not resolve the plan; letting the request through',
      );
      return false;
    }
  }
}
