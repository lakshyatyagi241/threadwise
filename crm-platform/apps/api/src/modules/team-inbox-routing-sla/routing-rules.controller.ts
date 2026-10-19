import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createRoutingRuleSchema,
  updateBusinessHoursSchema,
  listRoutingRulesQuerySchema,
  reorderRoutingRulesSchema,
  updateRoutingRuleSchema,
  updateRoutingSettingsSchema,
  type CreateRoutingRuleInput,
  type ListRoutingRulesQuery,
  type UpdateBusinessHoursInput,
  type ReorderRoutingRulesInput,
  type UpdateRoutingRuleInput,
  type UpdateRoutingSettingsInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { BusinessHoursService } from './business-hours.service';
import { RoutingRulesService } from './routing-rules.service';

/**
 * Auto-assignment: the routing rules, their settings and the business hours they read (TW-TIB2-001, 004 to 009). Every route needs the plan feature `inbox_routing` (422
 * PLAN_FEATURE_LOCKED, reads included); reading needs `inbox.settings.read`, writing `inbox.routing.manage` (Owner and Admin by default).
 * The literal `rules/reorder` is declared before `rules/:id`: Express matches in registration order.
 */
@ApiTags('team-inbox')
@ActorKinds('user')
@RequirePlanFeature('inbox_routing')
@Controller({ path: 'inbox/routing', version: '2' })
export class RoutingRulesController {
  constructor(
    private readonly rules: RoutingRulesService,
    private readonly businessHours: BusinessHoursService,
  ) {}

  @Get('rules')
  @RequirePermission('inbox.settings.read')
  @ApiOperation({ summary: 'The routing rules, in priority order (search by name, cursor pages)' })
  list(@Query(zodPipe(listRoutingRulesQuerySchema)) query: ListRoutingRulesQuery) {
    return this.rules.list(query);
  }

  @Post('rules')
  @Idempotent()
  @RequirePermission('inbox.routing.manage')
  @ApiOperation({
    summary: 'Create a rule',
    description:
      'Saved last in the order, switched off unless `isActive` is true. Refused with 422 PLAN_LIMIT_REACHED at the plan limit.',
  })
  create(@Body(zodPipe(createRoutingRuleSchema)) body: CreateRoutingRuleInput) {
    return this.rules.create(body);
  }

  @Post('rules/reorder')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.routing.manage')
  @ApiOperation({ summary: 'Put the listed rules in this priority order (they keep their slots)' })
  reorder(@Body(zodPipe(reorderRoutingRulesSchema)) body: ReorderRoutingRulesInput) {
    return this.rules.reorder(body);
  }

  @Get('rules/:id')
  @RequirePermission('inbox.settings.read')
  @ApiOperation({ summary: 'One rule' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.rules.get(id);
  }

  @Patch('rules/:id')
  @Idempotent()
  @RequirePermission('inbox.routing.manage')
  @ApiOperation({
    summary: 'Edit a rule or switch it on and off',
    description:
      'Any subset of fields with the `rowVersion` read; a stale one is 409 ROW_VERSION_CONFLICT.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateRoutingRuleSchema)) body: UpdateRoutingRuleInput,
  ) {
    return this.rules.update(id, body);
  }

  @Delete('rules/:id')
  @Idempotent()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('inbox.routing.manage')
  @ApiOperation({ summary: 'Delete a rule' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.rules.remove(id);
  }

  @Post('rules/:id/duplicate')
  @Idempotent()
  @RequirePermission('inbox.routing.manage')
  @ApiOperation({
    summary: 'Copy a rule: it goes last, switched off, and counts against the plan limit',
  })
  duplicate(@Param('id', ParseUUIDPipe) id: string) {
    return this.rules.duplicate(id);
  }

  @Get('settings')
  @RequirePermission('inbox.settings.read')
  @ApiOperation({ summary: 'Auto-assignment settings (keep returning contacts with their agent)' })
  settings() {
    return this.rules.settings();
  }

  @Put('settings')
  @Idempotent()
  @RequirePermission('inbox.routing.manage')
  @ApiOperation({ summary: 'Change the auto-assignment settings' })
  updateSettings(@Body(zodPipe(updateRoutingSettingsSchema)) body: UpdateRoutingSettingsInput) {
    return this.rules.updateSettings(body);
  }

  @Get('business-hours')
  @RequirePermission('inbox.settings.read')
  @ApiOperation({
    summary: 'The workspace business hours: the weekly schedule and the time zone',
    description:
      'Shows Mon-Fri 09:00-18:00 when no schedule has been saved. Until one is saved the workspace counts as open all the time.',
  })
  getBusinessHours() {
    return this.businessHours.get();
  }

  @Put('business-hours')
  @Idempotent()
  @RequirePermission('inbox.routing.manage')
  @ApiOperation({
    summary: 'Save the business hours',
    description:
      'Replaces the seven day windows. The time zone is kept only when the caller is the workspace owner; for anyone else it is ignored.',
  })
  updateBusinessHours(@Body(zodPipe(updateBusinessHoursSchema)) body: UpdateBusinessHoursInput) {
    return this.businessHours.update(body);
  }
}
