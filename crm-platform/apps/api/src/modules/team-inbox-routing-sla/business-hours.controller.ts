import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { updateBusinessHoursSchema, type UpdateBusinessHoursInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { BusinessHoursService } from './business-hours.service';

/**
 * The workspace business hours (TW-TIB2-001). Same address as before (`/inbox/routing/business-hours`) but not under the routing
 * controller's plan gate: the routing rules AND the SLA clocks read these hours, so the plan check (`inbox_routing` or `inbox_sla`) is in
 * `BusinessHoursService.assertPlan`. Reading needs `inbox.settings.read`, writing `inbox.routing.manage`.
 */
@ApiTags('team-inbox')
@ActorKinds('user')
@Controller({ path: 'inbox/routing/business-hours', version: '2' })
export class BusinessHoursController {
  constructor(private readonly businessHours: BusinessHoursService) {}

  @Get()
  @RequirePermission('inbox.settings.read')
  @ApiOperation({
    summary: 'The workspace business hours: the weekly schedule and the time zone',
    description:
      'Shows Mon-Fri 09:00-18:00 when no schedule has been saved. Until one is saved the workspace counts as open all the time. Needs Smart routing or SLA policies on the plan.',
  })
  get() {
    return this.businessHours.get();
  }

  @Put()
  @Idempotent()
  @RequirePermission('inbox.routing.manage')
  @ApiOperation({
    summary: 'Save the business hours',
    description:
      'Replaces the seven day windows. The time zone is kept only when the caller is the workspace owner; for anyone else it is ignored.',
  })
  update(@Body(zodPipe(updateBusinessHoursSchema)) body: UpdateBusinessHoursInput) {
    return this.businessHours.update(body);
  }
}
