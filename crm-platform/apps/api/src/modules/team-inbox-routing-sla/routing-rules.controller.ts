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
  listRoutingRulesQuerySchema,
  reorderRoutingRulesSchema,
  routingTestRequestSchema,
  updateRoutingRuleSchema,
  updateRoutingSettingsSchema,
  type CreateRoutingRuleInput,
  type ListRoutingRulesQuery,
  type ReorderRoutingRulesInput,
  type RoutingTestRequest,
  type UpdateRoutingRuleInput,
  type UpdateRoutingSettingsInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { RoutingRulesService } from './routing-rules.service';

/**
 * Auto-assignment: the routing rules and their settings (TW-TIB2-004 to 009; the business hours are `BusinessHoursController`). Every route needs the plan feature `inbox_routing` (422
 * PLAN_FEATURE_LOCKED, reads included); reading needs `inbox.settings.read`, writing `inbox.routing.manage` (Owner and Admin by default).
 * The literal `rules/reorder` is declared before `rules/:id`: Express matches in registration order.
 */
@ApiTags('team-inbox')
@ActorKinds('user')
@RequirePlanFeature('inbox_routing')
@Controller({ path: 'inbox/routing', version: '2' })
export class RoutingRulesController {
  constructor(private readonly rules: RoutingRulesService) {}

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

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inbox.settings.read')
  @ApiOperation({
    summary: 'Try it: which step would decide for this contact, channel and message',
    description:
      'Runs the arrival decision (contact agent, rules in order, Everyone else, waiting queue) in a read-only transaction. Assigns nothing, counts nothing, moves no round robin cursor, writes no event.',
  })
  test(@Body(zodPipe(routingTestRequestSchema)) body: RoutingTestRequest) {
    return this.rules.test(body);
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
}
