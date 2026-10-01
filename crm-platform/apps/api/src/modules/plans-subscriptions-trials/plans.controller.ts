import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorKinds } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { AllowWhileGated } from '../auth';
import { PlanEntitlementService } from './plan-entitlement.service';

/**
 * The plans a workspace can see (TW-AUTH-009's plan step; TW-PLAN-011's picker
 * reads the same list). Reachable while the account is gated, like onboarding:
 * a person who has not verified their email still gets to see what they could
 * choose.
 */
@ApiTags('plans')
@ActorKinds('user')
@AllowWhileGated()
@Controller({ path: 'plans', version: '2' })
export class PlansController {
  constructor(private readonly entitlements: PlanEntitlementService) {}

  @Get()
  @ApiOperation({
    summary: 'Active plans, cheapest tier first, with the caller’s current plan marked',
  })
  async list() {
    return this.entitlements.cardsForOrg(RequestContextStore.require().orgId);
  }
}
