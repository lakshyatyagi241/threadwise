import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  changePlanRequestSchema,
  type BillingPlansResponse,
  type BillingStatus,
  type BillingUsageResponse,
  type ChangePlanRequest,
  type CancelSubscriptionResponse,
  type ChangePlanResponse,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RbacService } from '../../kernel/rbac/rbac.service';
import { BillingService } from './billing.service';
import { SubscriptionService } from './subscription.service';
import { AllowWhenTrialExpired } from './trial-gate.guard';

/**
 * The workspace's own plan: pick, switch, downgrade, see usage (WD-PLAN-011..016). Everything acts on the caller's workspace.
 * Viewing needs no capability key (any member, as in WaDesk); changing the plan needs `plan.subscription.manage`, which the Owner
 * and Admin presets hold. All of it stays reachable after the trial ends: this is the recovery path.
 */
@ApiTags('billing')
@ActorKinds('user')
@AllowWhenTrialExpired()
@Controller({ path: 'billing', version: '2' })
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly rbac: RbacService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  @Get('plans')
  @ApiOperation({
    summary: 'Active plans with the workspace’s plan marked and what choosing each one does',
  })
  async plans(): Promise<BillingPlansResponse> {
    const ctx = RequestContextStore.require();
    const grants = await this.rbac.grantsForUser(ctx.orgId, ctx.userId!);
    return this.billing.plans(this.rbac.can(grants, 'plan.subscription.manage').allowed);
  }

  @Get('status')
  @ApiOperation({ summary: 'Trial and renewal state for the app-shell bars' })
  status(): Promise<BillingStatus> {
    return this.billing.status();
  }

  @Get('usage')
  @ApiOperation({ summary: 'Plan, caps, usage this cycle and unlocked features' })
  usage(): Promise<BillingUsageResponse> {
    return this.billing.usagePanel();
  }

  @Post('plan')
  @Idempotent()
  @RequirePermission('plan.subscription.manage')
  @ApiOperation({
    summary:
      'Switch the workspace to a free plan or a cheaper/equal paid plan (a dearer plan is a checkout)',
  })
  async change(
    @Body(zodPipe(changePlanRequestSchema)) body: ChangePlanRequest,
  ): Promise<ChangePlanResponse> {
    return this.billing.change(body.planSlug);
  }

  @Post('subscription/cancel')
  @Idempotent()
  @RequirePermission('plan.subscription.manage')
  @ApiOperation({
    summary:
      'Stop the workspace subscription from renewing; the paid period keeps running (WD-PLAN-012)',
  })
  cancelAutoRenew(): Promise<CancelSubscriptionResponse> {
    return this.subscriptions.cancel();
  }
}
