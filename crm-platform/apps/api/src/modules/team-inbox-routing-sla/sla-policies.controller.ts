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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createInboxSlaPolicySchema,
  updateInboxSlaPolicySchema,
  type CreateInboxSlaPolicyInput,
  type UpdateInboxSlaPolicyInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { SlaPoliciesService } from './sla-policies.service';

/**
 * SLA policies (TW-TIB2-024, 025): the response targets. Every route needs the plan feature `inbox_sla` (422 PLAN_FEATURE_LOCKED
 * otherwise, reads included). Reading takes `inbox.settings.read`; changing takes `inbox.sla.manage`.
 */
@ApiTags('team-inbox')
@ActorKinds('user')
@RequirePlanFeature('inbox_sla')
@Controller({ path: 'inbox/sla/policies', version: '2' })
export class SlaPoliciesController {
  constructor(private readonly policies: SlaPoliciesService) {}

  @Get()
  @RequirePermission('inbox.settings.read')
  @ApiOperation({ summary: 'The workspace’s SLA policies, the default first' })
  async list() {
    return this.policies.list();
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inbox.sla.manage')
  @ApiOperation({
    summary: 'Create an SLA policy',
    description:
      'Targets are in minutes (first response 1 to 100000, resolution 1 to 1000000, either may be null for no clock). Making it the default clears the flag on the others; the workspace’s first policy is always the default.',
  })
  async create(@Body(zodPipe(createInboxSlaPolicySchema)) body: CreateInboxSlaPolicyInput) {
    return this.policies.create(body);
  }

  @Patch(':id')
  @RequirePermission('inbox.sla.manage')
  @ApiOperation({
    summary: 'Edit an SLA policy',
    description:
      'Requires the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise). A null target removes that clock for new conversations; clocks already running keep their due times.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateInboxSlaPolicySchema)) body: UpdateInboxSlaPolicyInput,
  ) {
    return this.policies.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('inbox.sla.manage')
  @ApiOperation({
    summary: 'Delete an SLA policy',
    description: 'Conversations that used it keep their running clocks.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.policies.remove(id);
  }
}
