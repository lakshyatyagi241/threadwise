import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { type OnboardingResponse, type OnboardingWorkspaceRequest } from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { PlanEntitlementService } from '../../plans-subscriptions-trials';
import { PlatformSettingsService } from '../platform/platform-settings.service';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { AuthAuditService } from '../security/auth-audit.service';
import { isValidTimezone } from '../support/text';
import { ONBOARDING_BILLING_SOURCE, type OnboardingBillingSource } from './onboarding-billing.port';
import { suggestWorkspaceName } from './workspace-name';

type Step = 'workspace' | 'plan' | 'done';

/** Platform setting the CPN domain fills in; the plan step reads it and falls back to Reference's defaults. */
export const ONBOARDING_BILLING_KEY = 'onboarding.billing';
const DEFAULT_CREDITS_PER_MESSAGE = 1;
const DEFAULT_CURRENCY = 'USD';
/** With no billing domain answering, "Top up" leads to the plans page. */
const DEFAULT_TOP_UP_URL = '/account/plans';

interface BillingHints {
  creditsPerMessage?: unknown;
  defaultCurrency?: unknown;
  topUpUrl?: unknown;
}

interface OrgSettings {
  onboardingStep?: Step;
  industry?: OnboardingResponse['workspace']['industry'];
  sizeRange?: OnboardingResponse['workspace']['sizeRange'];
  timezone?: string;
  currency?: string;
}

/**
 * First-run setup after sign-up (TW-AUTH-008/009).
 *
 * The organization already exists (sign-up created it with its owner), so step
 * "workspace" is a profile of that organization, not a creation. Plans belong
 * to the PLAN domain: the plan step shows its active catalogue with the
 * caller's current plan marked, and "start free / skip" simply finishes (the
 * plan was already assigned at sign-up).
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly policy: SecurityPolicyService,
    private readonly audit: AuthAuditService,
    private readonly outbox: OutboxService,
    private readonly entitlements: PlanEntitlementService,
    private readonly settings: PlatformSettingsService,
    @Optional()
    @Inject(ONBOARDING_BILLING_SOURCE)
    private readonly billingSource?: OnboardingBillingSource,
  ) {}

  private actor(): { orgId: number; userId: number } {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId) throw AppError.unauthenticated();
    return { orgId: ctx.orgId, userId: ctx.userId };
  }

  async get(): Promise<OnboardingResponse> {
    const { orgId, userId } = this.actor();
    const [registration, plans, billing, fromSource, res] = await Promise.all([
      this.policy.registration(),
      this.entitlements.cardsForOrg(orgId),
      this.settings.get<BillingHints>(ONBOARDING_BILLING_KEY),
      // A source that fails must not stop onboarding: the defaults apply.
      this.billingSource?.hints().catch(() => undefined),
      this.db.txAs({ orgId, userId }, async (tx) =>
        tx.execute(sql`
          SELECT o.name, o.settings, u.email, p.phone_e164
          FROM organizations o
          JOIN users u ON u.org_id = o.id AND u.id = ${userId}
          LEFT JOIN user_profiles p ON p.org_id = o.id AND p.user_id = u.id
          WHERE o.id = ${orgId}
        `),
      ),
    ]);
    const row = res.rows[0] as unknown as {
      name: string;
      settings: OrgSettings;
      email: string;
      phone_e164: string | null;
    };
    return {
      step: row.settings.onboardingStep ?? 'done',
      workspace: {
        name: row.name,
        industry: row.settings.industry ?? null,
        sizeRange: row.settings.sizeRange ?? null,
        timezone: row.settings.timezone ?? null,
        currency: row.settings.currency ?? null,
      },
      suggestedName: suggestWorkspaceName(row.email),
      // Whoever has no mobile number yet gives one here, whichever way they signed up.
      needsPhone: !row.phone_e164,
      plans: plans.data,
      defaultTimezone: registration.defaultTimezone,
      billing: billingFor([billing, fromSource], row.settings.currency),
    };
  }

  async saveWorkspace(body: OnboardingWorkspaceRequest): Promise<OnboardingResponse> {
    const { orgId, userId } = this.actor();
    if (!isValidTimezone(body.timezone)) {
      throw AppError.validation('Unknown timezone', [
        { path: 'timezone', message: 'Not an IANA timezone.' },
      ]);
    }

    await this.db.txAs({ orgId, userId }, async (tx) => {
      const current = await tx.execute(sql`
        SELECT phone_e164 FROM user_profiles WHERE org_id = ${orgId} AND user_id = ${userId}
      `);
      const hasPhone = Boolean(
        (current.rows[0] as { phone_e164?: string | null } | undefined)?.phone_e164,
      );
      if (!hasPhone && !body.phone) {
        throw AppError.validation('A mobile number is required.', [
          { path: 'phone', message: 'A mobile number is required.' },
        ]);
      }

      const patch: OrgSettings = {
        industry: body.industry,
        sizeRange: body.sizeRange,
        timezone: body.timezone,
        currency: body.currency?.toUpperCase(),
      };
      // Saving the profile again later (it is an ordinary settings form after sign-up) must not send
      // the workspace back into first-run setup: only the first step moves to the plan step.
      await tx.execute(sql`
        UPDATE organizations
        SET name = ${body.name},
            settings = settings
              || ${JSON.stringify(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)))}::jsonb
              || jsonb_build_object('onboardingStep',
                   CASE WHEN settings->>'onboardingStep' = 'workspace' THEN 'plan'
                        ELSE COALESCE(settings->>'onboardingStep', 'done') END)
        WHERE id = ${orgId}
      `);
      if (body.phone) {
        // Only fills a missing number; changing one is a profile edit with re-verification.
        await tx.execute(sql`
          INSERT INTO user_profiles (org_id, user_id, phone_e164) VALUES (${orgId}, ${userId}, ${body.phone})
          ON CONFLICT (org_id, user_id) DO UPDATE SET phone_e164 = COALESCE(user_profiles.phone_e164, EXCLUDED.phone_e164)
        `);
      }
      await this.audit.record(tx, {
        event: 'workspace.onboarding_profile_saved',
        status: 'success',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
        payload: { industry: body.industry, sizeRange: body.sizeRange, timezone: body.timezone },
      });
      // HOOK for NOTIF: Reference drops a "Workspace created" in-app note (action: dashboard) here.
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: 'organizations',
        aggregateId: orgId,
        eventType: 'org.onboarding.workspace_configured',
        payload: { name: body.name, timezone: body.timezone, currency: body.currency ?? null },
      });
    });
    return this.get();
  }

  /** Finishes onboarding (also the "start free / skip" action of the plan step). */
  async complete(): Promise<OnboardingResponse> {
    const { orgId, userId } = this.actor();
    await this.db.txAs({ orgId, userId }, async (tx) => {
      await tx.execute(sql`
        UPDATE organizations SET settings = settings || '{"onboardingStep":"done"}'::jsonb WHERE id = ${orgId}
      `);
      await this.audit.record(tx, {
        event: 'workspace.onboarding_completed',
        status: 'success',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
      });
    });
    return this.get();
  }
}

/**
 * The plan step's credits explainer and top-up link. Each field comes from the first valid answer of: the operator's
 * `onboarding.billing` setting, the billing domains (through the port), then Reference's defaults (1 credit per message, USD, the
 * plans page). A malformed override falls through to the next answer instead of replacing it.
 */
function billingFor(
  sources: ReadonlyArray<BillingHints | undefined>,
  workspaceCurrency: string | undefined,
): OnboardingResponse['billing'] {
  const credits = (h?: BillingHints) =>
    typeof h?.creditsPerMessage === 'number' &&
    Number.isInteger(h.creditsPerMessage) &&
    h.creditsPerMessage >= 1
      ? h.creditsPerMessage
      : undefined;
  const currency = (h?: BillingHints) =>
    typeof h?.defaultCurrency === 'string' && /^[A-Za-z]{3}$/.test(h.defaultCurrency)
      ? h.defaultCurrency.toUpperCase()
      : undefined;
  // Same-site paths only: this value ends up in a link.
  const url = (h?: BillingHints) =>
    typeof h?.topUpUrl === 'string' && /^\/(?![/\\])/.test(h.topUpUrl) && h.topUpUrl.length <= 512
      ? h.topUpUrl
      : undefined;
  const first = <T>(pick: (h?: BillingHints) => T | undefined, fallback: T): T => {
    for (const h of sources) {
      const v = pick(h);
      if (v !== undefined) return v;
    }
    return fallback;
  };
  return {
    creditsPerMessage: first(credits, DEFAULT_CREDITS_PER_MESSAGE),
    displayCurrency: workspaceCurrency ?? first(currency, DEFAULT_CURRENCY),
    topUpUrl: first(url, DEFAULT_TOP_UP_URL),
  };
}
