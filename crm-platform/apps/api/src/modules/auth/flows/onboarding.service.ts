import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { type OnboardingResponse, type OnboardingWorkspaceRequest } from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { PlanEntitlementService } from '../../plans-subscriptions-trials';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { AuthAuditService } from '../security/auth-audit.service';
import { isValidTimezone, suggestWorkspaceName } from '../support/text';

type Step = 'workspace' | 'plan' | 'done';

interface OrgSettings {
  onboardingStep?: Step;
  industry?: OnboardingResponse['workspace']['industry'];
  sizeRange?: OnboardingResponse['workspace']['sizeRange'];
  timezone?: string;
  currency?: string;
}

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
  ) {}

  private actor(): { orgId: number; userId: number } {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId) throw AppError.unauthenticated();
    return { orgId: ctx.orgId, userId: ctx.userId };
  }

  async get(): Promise<OnboardingResponse> {
    const { orgId, userId } = this.actor();
    const [registration, plans, res] = await Promise.all([
      this.policy.registration(),
      this.entitlements.cardsForOrg(orgId),
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
      needsPhone: !row.phone_e164 && registration.otp.enabled,
      plans: plans.data,
      defaultTimezone: registration.defaultTimezone,
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
      const patch: OrgSettings = {
        industry: body.industry,
        sizeRange: body.sizeRange,
        timezone: body.timezone,
        currency: body.currency?.toUpperCase(),
        onboardingStep: 'plan',
      };
      await tx.execute(sql`
        UPDATE organizations
        SET name = ${body.name},
            settings = settings || ${JSON.stringify(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)))}::jsonb
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
