import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  defaultBillingCurrency,
  type OnboardingResponse,
  type OnboardingWorkspaceRequest,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { PlanEntitlementService } from '../../plans-subscriptions-trials';
import { PlatformSettingsService } from '../platform/platform-settings.service';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { AuthAuditService } from '../security/auth-audit.service';
import { isValidTimezone } from '../support/text';
import { suggestWorkspaceName } from './workspace-name';

type Step = 'workspace' | 'plan' | 'done';

/** Platform setting the CPN domain fills in; the plan step reads it and falls back to WaDesk's defaults. */
export const ONBOARDING_BILLING_KEY = 'onboarding.billing';
const DEFAULT_CREDITS_PER_MESSAGE = 1;
const DEFAULT_CURRENCY = 'USD';
/** Until credit-package checkout exists, "Top up" leads to the plans page the billing domain will replace. */
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
  country?: string;
  currency?: string;
}

/** Platform setting the General settings page saves; its `defaultCurrency` is the currency billing falls back to. */
const GENERAL_KEY = 'set.general';

/**
 * First-run setup after sign-up (WD-AUTH-008/009).
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
  ) {}

  private actor(): { orgId: number; userId: number } {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId) throw AppError.unauthenticated();
    return { orgId: ctx.orgId, userId: ctx.userId };
  }

  async get(): Promise<OnboardingResponse> {
    const { orgId, userId } = this.actor();
    const [registration, plans, billing, res, currencies] = await Promise.all([
      this.policy.registration(),
      this.entitlements.cardsForOrg(orgId),
      this.settings.get<BillingHints>(ONBOARDING_BILLING_KEY),
      this.db.txAs({ orgId, userId }, async (tx) =>
        tx.execute(sql`
          SELECT o.name, o.settings, u.email, p.phone_e164
          FROM organizations o
          JOIN users u ON u.org_id = o.id AND u.id = ${userId}
          LEFT JOIN user_profiles p ON p.org_id = o.id AND p.user_id = u.id
          WHERE o.id = ${orgId}
        `),
      ),
      this.currencyOptions(),
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
        country: row.settings.country ?? null,
        currency: row.settings.currency ?? null,
      },
      currencies,
      suggestedName: suggestWorkspaceName(row.email),
      // Whoever has no mobile number yet gives one here, whichever way they signed up.
      needsPhone: !row.phone_e164,
      plans: plans.data,
      defaultTimezone: registration.defaultTimezone,
      billing: billingFor(billing, row.settings.currency),
    };
  }

  /**
   * The currencies a workspace can be billed in: the platform's own and every one Meta's rate card is stored for (the same set the
   * wallet bills in; `BillingCurrencyService.billable`, read here directly because the wallet module sits above auth).
   */
  private async currencyOptions(): Promise<OnboardingResponse['currencies']> {
    const [general, cards] = await Promise.all([
      this.settings.get<{ defaultCurrency?: unknown }>(GENERAL_KEY),
      this.db.tx(async (tx) =>
        tx.execute(sql`SELECT DISTINCT currency FROM meta_rate_cards ORDER BY currency`),
      ),
    ]);
    const configured = general?.defaultCurrency;
    const platform =
      typeof configured === 'string' && /^[A-Za-z]{3}$/.test(configured)
        ? configured.toUpperCase()
        : DEFAULT_CURRENCY;
    const stored = (cards.rows as unknown as Array<{ currency: string }>).map((r) => r.currency);
    return { available: [...new Set([platform, ...stored])].sort(), platform };
  }

  async saveWorkspace(body: OnboardingWorkspaceRequest): Promise<OnboardingResponse> {
    const { orgId, userId } = this.actor();
    if (!isValidTimezone(body.timezone)) {
      throw AppError.validation('Unknown timezone', [
        { path: 'timezone', message: 'Not an IANA timezone.' },
      ]);
    }
    if (body.country !== undefined && !isValidCountry(body.country)) {
      throw AppError.validation('Unknown country', [
        { path: 'country', message: 'Not an ISO 3166-1 country code.' },
      ]);
    }
    const options = await this.currencyOptions();
    if (body.currency !== undefined && !options.available.includes(body.currency)) {
      throw AppError.validation('That currency cannot be billed', [
        { path: 'currency', message: 'Not a currency this platform bills in.' },
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

      // Left out, the currency follows the country (India: INR, elsewhere: USD, else the platform's own). Once the wallet has
      // moved, the currency is fixed (money is never converted); an operator changes it, with a reason.
      const own = await tx.execute(sql`
        SELECT upper(settings->>'currency') AS currency,
               EXISTS (SELECT 1 FROM wallet_transactions WHERE org_id = ${orgId}) AS used
        FROM organizations WHERE id = ${orgId}
      `);
      const saved = own.rows[0] as unknown as { currency: string | null; used: boolean };
      const currency =
        body.currency ??
        (body.country
          ? defaultBillingCurrency(body.country, options.available, options.platform)
          : undefined);
      if (currency && saved.used && saved.currency && currency !== saved.currency) {
        throw AppError.validation('The billing currency is fixed once the wallet is in use', [
          { path: 'currency', message: 'Ask support to change it.' },
        ]);
      }

      const patch: OrgSettings = {
        industry: body.industry,
        sizeRange: body.sizeRange,
        timezone: body.timezone,
        country: body.country,
        currency,
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
        payload: {
          industry: body.industry,
          sizeRange: body.sizeRange,
          timezone: body.timezone,
          country: body.country ?? null,
          currency: currency ?? null,
        },
      });
      // HOOK for NOTIF: WaDesk drops a "Workspace created" in-app note (action: dashboard) here.
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: 'organizations',
        aggregateId: orgId,
        eventType: 'org.onboarding.workspace_configured',
        payload: {
          name: body.name,
          timezone: body.timezone,
          country: body.country ?? null,
          currency: currency ?? null,
        },
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

/** ISO 3166-1 alpha-2: two letters the runtime knows a region name for (an unassigned code comes back as itself). */
function isValidCountry(code: string): boolean {
  if (!/^[A-Z]{2}$/.test(code)) return false;
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
    return Boolean(name) && name !== code && name !== 'Unknown Region';
  } catch {
    return false;
  }
}

/**
 * The plan step's credits explainer and top-up link, from the `onboarding.billing` platform setting
 * when CPN has set it, else WaDesk's defaults (1 credit per message, USD, the plans page).
 */
function billingFor(
  hints: BillingHints | undefined,
  workspaceCurrency: string | undefined,
): OnboardingResponse['billing'] {
  const credits = hints?.creditsPerMessage;
  const currency = hints?.defaultCurrency;
  const url = hints?.topUpUrl;
  const platformCurrency =
    typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency)
      ? currency.toUpperCase()
      : DEFAULT_CURRENCY;
  return {
    creditsPerMessage:
      typeof credits === 'number' && Number.isInteger(credits) && credits >= 1
        ? credits
        : DEFAULT_CREDITS_PER_MESSAGE,
    displayCurrency: workspaceCurrency ?? platformCurrency,
    // Same-site paths only: this value ends up in a link.
    topUpUrl:
      typeof url === 'string' && /^\/(?![/\\])/.test(url) && url.length <= 512
        ? url
        : DEFAULT_TOP_UP_URL,
  };
}
