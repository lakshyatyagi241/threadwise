import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { warmerProfileInputSchema, type WarmerProfileInput } from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { WarmerService } from './warmer/warmer.service';

/**
 * The warmer page's API (TW-SCHED-036, 037): every connected number with its profile, today's budget and health, and saving a
 * number's profile. Needs `sched.warmer.manage` and the plan's `whatsapp_warmer` flag (Reference's page had a gate that never closed).
 */
@ApiTags('warmer')
@ActorKinds('user')
@Controller({ path: 'warmer', version: '2' })
export class WarmerController {
  constructor(
    private readonly warmer: WarmerService,
    private readonly plans: PlanEntitlementService,
  ) {}

  @Get()
  @RequirePermission('sched.warmer.manage')
  @ApiOperation({ summary: 'Numbers with their warmer profile, budget today and health score' })
  async list() {
    const { orgId } = RequestContextStore.require();
    await this.plans.assertFeature(orgId, 'whatsapp_warmer');
    return this.warmer.list(orgId);
  }

  @Put(':key')
  @RequirePermission('sched.warmer.manage')
  @ApiOperation({ summary: "Save a number's warmer profile (`<engine>:<uuid>`)" })
  async save(
    @Param('key') key: string,
    @Body(zodPipe(warmerProfileInputSchema)) body: WarmerProfileInput,
  ) {
    const { orgId } = RequestContextStore.require();
    await this.plans.assertFeature(orgId, 'whatsapp_warmer');
    if (!/^(baileys|waba|twilio):[0-9a-f-]{36}$/i.test(key)) throw AppError.notFound('Number', key);
    return this.warmer.save(orgId, key, body);
  }
}
