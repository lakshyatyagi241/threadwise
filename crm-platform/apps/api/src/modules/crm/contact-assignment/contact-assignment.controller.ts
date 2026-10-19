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
  createAssignmentRuleSchema,
  listAssignmentRunsQuerySchema,
  reorderAssignmentRulesSchema,
  testAssignmentSchema,
  updateAssignmentRuleSchema,
  updateAssignmentSettingsSchema,
  type CreateAssignmentRuleInput,
  type ListAssignmentRunsQuery,
  type ReorderAssignmentRulesInput,
  type TestAssignmentInput,
  type UpdateAssignmentRuleInput,
  type UpdateAssignmentSettingsInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../../plans-subscriptions-trials';
import { ContactAssignmentService } from './contact-assignment.service';

/**
 * Settings > Automation > Record assignment rules: the switch (default OFF), the priority-ordered rules that give new contacts, companies
 * and deals to a person, and the log of what the engine did. Reading needs `crm.assignment.read`, everything else `crm.assignment.manage`
 * (Manager and above). Every route needs the plan feature `record_assignment` (higher plans only; 422 PLAN_FEATURE_LOCKED otherwise).
 * Literal paths come before `:id`.
 */
@ApiTags('contact-assignment')
@ActorKinds('user')
@RequirePlanFeature('record_assignment')
@Controller({ path: 'assignment', version: '2' })
export class ContactAssignmentController {
  constructor(private readonly assignment: ContactAssignmentService) {}

  @Get('settings')
  @RequirePermission('crm.assignment.read')
  @ApiOperation({
    summary: 'Is record auto-assignment on (default off), and does it cover imports',
  })
  async settings() {
    return this.assignment.getSettings();
  }

  @Put('settings')
  @RequirePermission('crm.assignment.manage')
  @ApiOperation({
    summary: 'Switch auto-assignment on or off, and choose whether imported contacts are assigned',
  })
  async updateSettings(
    @Body(zodPipe(updateAssignmentSettingsSchema)) body: UpdateAssignmentSettingsInput,
  ) {
    return this.assignment.updateSettings(body);
  }

  @Get('rules')
  @RequirePermission('crm.assignment.read')
  @ApiOperation({ summary: 'The rules of both subjects, each in priority order' })
  async list() {
    return this.assignment.list();
  }

  @Post('rules')
  @Idempotent()
  @RequirePermission('crm.assignment.manage')
  @ApiOperation({ summary: "Add a rule (last in its subject's order)" })
  async create(@Body(zodPipe(createAssignmentRuleSchema)) body: CreateAssignmentRuleInput) {
    return this.assignment.create(body);
  }

  @Get('runs')
  @RequirePermission('crm.assignment.read')
  @ApiOperation({
    summary: 'The run log: why each record was assigned, reassigned or left alone, newest first',
    description: 'Filter by module, rule, record (with the module) or outcome. Kept 90 days.',
  })
  async runs(@Query(zodPipe(listAssignmentRunsQuerySchema)) query: ListAssignmentRunsQuery) {
    return this.assignment.runs(query);
  }

  @Post('rules/reorder')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm.assignment.manage')
  @ApiOperation({ summary: 'Put the listed rules of one subject first, in this order' })
  async reorder(@Body(zodPipe(reorderAssignmentRulesSchema)) body: ReorderAssignmentRulesInput) {
    return this.assignment.reorder(body);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm.assignment.read')
  @ApiOperation({
    summary: 'Which rule would take this record, and who? Changes nothing',
    description:
      'Name an existing contact, company or deal. Returns every rule tried and why. Works while the switch is off.',
  })
  async test(@Body(zodPipe(testAssignmentSchema)) body: TestAssignmentInput) {
    return this.assignment.test(body);
  }

  @Post('rules/:id/clone')
  @Idempotent()
  @RequirePermission('crm.assignment.manage')
  @ApiOperation({ summary: 'Copy a rule: the copy is paused and last in its module' })
  async clone(@Param('id', ParseUUIDPipe) id: string) {
    return this.assignment.clone(id);
  }

  @Post('rules/:id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm.assignment.manage')
  @ApiOperation({ summary: 'Activate a rule: it is prioritised and starts taking records' })
  async activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.assignment.setActive(id, true);
  }

  @Post('rules/:id/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm.assignment.manage')
  @ApiOperation({
    summary: 'Pause a rule: it keeps its place but is not prioritised and never runs',
  })
  async pause(@Param('id', ParseUUIDPipe) id: string) {
    return this.assignment.setActive(id, false);
  }

  @Patch('rules/:id')
  @RequirePermission('crm.assignment.manage')
  @ApiOperation({
    summary: 'Edit a rule (requires the rowVersion you read; a changed pool restarts the rotation)',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateAssignmentRuleSchema)) body: UpdateAssignmentRuleInput,
  ) {
    return this.assignment.update(id, body);
  }

  @Delete('rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('crm.assignment.manage')
  @ApiOperation({ summary: 'Delete a rule' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.assignment.remove(id);
  }
}
