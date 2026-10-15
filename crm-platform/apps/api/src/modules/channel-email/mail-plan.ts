import { Injectable } from '@nestjs/common';
import type { PlanFeatureKey, PlanLimitKey } from '@crm/contracts';
import { PlanEntitlementService } from '../plans-subscriptions-trials';

/**
 * The plan side of the Email channel (docs/threadwise-port/plan/channel-email-build.md decision 8). `email_channel` is a plan FEATURE the
 * Marketplace app `email` grants (default off); `email_mailboxes` is the cap on connected mailboxes (0 = unlimited).
 *
 * A workspace that loses the feature keeps its mail and its conversations: only the doors close (the routes answer 422
 * PLAN_FEATURE_LOCKED, the sync stops, a reply cannot be sent).
 */
export const MAIL_FEATURE = 'email_channel' satisfies PlanFeatureKey;
export const MAIL_MAILBOX_LIMIT_KEY = 'email_mailboxes' satisfies PlanLimitKey;
/** Mails sent per calendar month, replies and campaign mail together (Reference's `email_monthly_limit`); 0 = unlimited. */
export const MAIL_MONTHLY_LIMIT_KEY = 'email_monthly' satisfies PlanLimitKey;

@Injectable()
export class MailPlan {
  constructor(private readonly entitlements: PlanEntitlementService) {}

  isEnabled(orgId: number): Promise<boolean> {
    return this.entitlements.featureEnabled(orgId, MAIL_FEATURE);
  }

  /** The plan's mailbox cap; 0 = unlimited. */
  mailboxLimit(orgId: number): Promise<number> {
    return this.entitlements.limit(orgId, MAIL_MAILBOX_LIMIT_KEY);
  }

  /** The plan's cap on mails sent in a calendar month; 0 = unlimited. */
  monthlyLimit(orgId: number): Promise<number> {
    return this.entitlements.limit(orgId, MAIL_MONTHLY_LIMIT_KEY);
  }
}
