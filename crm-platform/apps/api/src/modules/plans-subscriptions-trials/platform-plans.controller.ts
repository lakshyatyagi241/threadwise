import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createPlanRequestSchema,
  setPlanActiveRequestSchema,
  updatePlanRequestSchema,
  uuidSchema,
  type CreatePlanPayload,
  type SetPlanActiveRequest,
  type UpdatePlanPayload,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { PlanAdminService } from './plan-admin.service';

/**
 * Plan catalogue for platform operators (WD-PLAN-001..005). Every operator role
 * reads; only super admins write (the guard's role list), and every write is
 * recorded in security_events.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/plans', version: '2' })
export class PlatformPlansController {
  constructor(private readonly plans: PlanAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Every plan with how many organizations use it, plus the KPI summary' })
  async list() {
    return this.plans.list();
  }

  // Declared before ':id': the route parameter is a uuid and would reject this literal.
  @Get('addon-options')
  @ApiOperation({
    summary:
      'The Marketplace add-on packs a plan may make visible to its workspaces (the plan form’s selector)',
  })
  async addonOptions() {
    return this.plans.addonOptions();
  }

  @Get(':id')
  @ApiOperation({ summary: 'One plan' })
  async one(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.plans.get(id);
  }

  @Post()
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Create a plan (the slug is derived from the name when not given)' })
  async create(@Body(zodPipe(createPlanRequestSchema)) body: CreatePlanPayload) {
    return this.plans.create(body);
  }

  @Patch(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Update a plan (partial; the slug never changes)' })
  async update(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updatePlanRequestSchema)) body: UpdatePlanPayload,
  ) {
    return this.plans.update(id, body);
  }

  @Patch(':id/active')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Activate or deactivate a plan (hides it from buyers; the signup default is refused)',
  })
  async setActive(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(setPlanActiveRequestSchema)) body: SetPlanActiveRequest,
  ) {
    return this.plans.setActive(id, body.isActive);
  }

  @Delete(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Delete a plan no organization uses' })
  async remove(@Param('id', zodPipe(uuidSchema)) id: string) {
    await this.plans.remove(id);
    return { ok: true as const };
  }
}
