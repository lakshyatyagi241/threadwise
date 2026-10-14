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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createAssignmentRuleSchema,
  reorderAssignmentRulesSchema,
  testAssignmentSchema,
  updateAssignmentRuleSchema,
  updateAssignmentSettingsSchema,
  type CreateAssignmentRuleInput,
  type ReorderAssignmentRulesInput,
  type TestAssignmentInput,
  type UpdateAssignmentRuleInput,
  type UpdateAssignmentSettingsInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { ContactAssignmentService } from './contact-assignment.service';

/**
 * Settings > Automation > Contact assignment: the switch (default OFF) and the priority-ordered rules that give new contacts and deals to
 * a person. Reading needs `crm.assignment.read`, everything else `crm.assignment.manage` (Manager and above), and writing needs the plan
 * feature routing rules use. Literal paths come before `:id`.
 */
@ApiTags('contact-assignment')
@ActorKinds('user')
@Controller({ path: 'assignment', version: '2' })
export class ContactAssignmentController {
  constructor(private readonly assignment: ContactAssignmentService) {}

  @Get('settings')
  @RequirePermission('crm.assignment.read')
  @ApiOperation({
    summary: 'Is contact and deal auto-assignment on (default off), and does it cover imports',
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
      'Name an existing contact or deal, or describe one. Works while the switch is off.',
  })
  async test(@Body(zodPipe(testAssignmentSchema)) body: TestAssignmentInput) {
    return this.assignment.test(body);
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
