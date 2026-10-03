import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createWhatsappProviderSchema,
  listAssignmentsQuerySchema,
  providerVersionedActionSchema,
  setAssignmentSchema,
  switchWorkspaceProviderSchema,
  testWhatsappProviderSchema,
  updateWhatsappProviderSchema,
  uuidSchema,
  type CreateWhatsappProviderInput,
  type ListAssignmentsQuery,
  type ProviderVersionedActionInput,
  type SetAssignmentInput,
  type SwitchWorkspaceProviderInput,
  type TestWhatsappProviderInput,
  type UpdateWhatsappProviderInput,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard } from '../auth';
import { PlatformPermission, PlatformPermissionGuard } from '../roles-permissions';
import { ProviderAssignmentsService } from './provider-assignments.service';
import { ProviderSwitchService } from './provider-switch.service';
import { WhatsappProvidersService } from './whatsapp-providers.service';

function operatorId(): number {
  const id = RequestContextStore.require().actorId;
  if (!id) throw AppError.unauthenticated();
  return id;
}

/**
 * The operator's WhatsApp provider registry (the BSP switch): which provider the SaaS sends WhatsApp through, a workspace's override, and
 * moving a workspace's connected numbers from one provider to another. Secrets are write only: no response carries one.
 *
 * Reading needs `platform.whatsapp_providers.view`; adding, changing, enabling, the default, the live test and assignments need
 * `.manage`; the number switch needs `.switch`. Literal paths come before the `:id` routes.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard, PlatformPermissionGuard)
@Controller({ path: 'platform/whatsapp-providers', version: '2' })
export class WhatsappProvidersController {
  constructor(
    private readonly providers: WhatsappProvidersService,
    private readonly assignments: ProviderAssignmentsService,
    private readonly switcher: ProviderSwitchService,
  ) {}

  @Get()
  @PlatformPermission('platform.whatsapp_providers.view')
  @ApiOperation({
    summary: 'The providers, the two built-in ones included, with their number counts',
  })
  list() {
    return this.providers.list();
  }

  @Post()
  @PlatformPermission('platform.whatsapp_providers.manage')
  @ApiOperation({
    summary: 'Add a provider (it starts disabled; secrets are sealed and never returned)',
  })
  create(@Body(zodPipe(createWhatsappProviderSchema)) body: CreateWhatsappProviderInput) {
    return this.providers.create(body, operatorId());
  }

  @Delete('default')
  @PlatformPermission('platform.whatsapp_providers.manage')
  @ApiOperation({
    summary: 'Clear the registry default: new numbers follow the platform WhatsApp setting again',
  })
  clearDefault() {
    return this.providers.clearDefault();
  }

  @Get('assignments')
  @PlatformPermission('platform.whatsapp_providers.view')
  @ApiOperation({
    summary: 'Workspaces with their override, effective provider and numbers on another provider',
  })
  listAssignments(@Query(zodPipe(listAssignmentsQuerySchema)) query: ListAssignmentsQuery) {
    return this.assignments.list(query);
  }

  @Put('workspaces/:workspaceId/assignment')
  @PlatformPermission('platform.whatsapp_providers.manage')
  @ApiOperation({
    summary:
      'Set the provider new numbers of a workspace connect through (existing numbers do not move)',
  })
  setAssignment(
    @Param('workspaceId', zodPipe(uuidSchema)) workspaceId: string,
    @Body(zodPipe(setAssignmentSchema)) body: SetAssignmentInput,
  ) {
    return this.assignments.set(workspaceId, body, operatorId());
  }

  @Delete('workspaces/:workspaceId/assignment')
  @PlatformPermission('platform.whatsapp_providers.manage')
  @ApiOperation({ summary: 'Clear a workspace override: it follows the default again' })
  clearAssignment(@Param('workspaceId', zodPipe(uuidSchema)) workspaceId: string) {
    return this.assignments.clear(workspaceId);
  }

  @Post('workspaces/:workspaceId/switch')
  @PlatformPermission('platform.whatsapp_providers.switch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Move a workspace’s connected numbers to another provider (dryRun lists what would happen)',
    description:
      'Each number is re-subscribed through the new route first and only re-pointed when that worked. A number that lacks a credential the target needs is blocked and listed. Switch back to roll back.',
  })
  switchWorkspace(
    @Param('workspaceId', zodPipe(uuidSchema)) workspaceId: string,
    @Body(zodPipe(switchWorkspaceProviderSchema)) body: SwitchWorkspaceProviderInput,
  ) {
    return this.switcher.switchWorkspace(workspaceId, body, operatorId());
  }

  @Get(':id')
  @PlatformPermission('platform.whatsapp_providers.view')
  @ApiOperation({ summary: 'One provider' })
  get(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.providers.get(id);
  }

  @Patch(':id')
  @PlatformPermission('platform.whatsapp_providers.manage')
  @ApiOperation({
    summary: 'Change a provider (absent secrets keep their value; rowVersion required)',
  })
  update(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updateWhatsappProviderSchema)) body: UpdateWhatsappProviderInput,
  ) {
    return this.providers.update(id, body);
  }

  @Post(':id/activate')
  @PlatformPermission('platform.whatsapp_providers.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Make the provider selectable for new numbers and assignments' })
  activate(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(providerVersionedActionSchema)) body: ProviderVersionedActionInput,
  ) {
    return this.providers.setStatus(id, 'active', body.rowVersion);
  }

  @Post(':id/disable')
  @PlatformPermission('platform.whatsapp_providers.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stop offering the provider for new numbers; numbers already on it keep sending',
  })
  disable(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(providerVersionedActionSchema)) body: ProviderVersionedActionInput,
  ) {
    return this.providers.setStatus(id, 'disabled', body.rowVersion);
  }

  @Post(':id/archive')
  @PlatformPermission('platform.whatsapp_providers.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retire the provider (refused while a number or workspace still uses it)',
  })
  archive(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(providerVersionedActionSchema)) body: ProviderVersionedActionInput,
  ) {
    return this.providers.setStatus(id, 'archived', body.rowVersion);
  }

  @Post(':id/default')
  @PlatformPermission('platform.whatsapp_providers.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Make this the default provider for new numbers (at most one)' })
  makeDefault(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(providerVersionedActionSchema)) body: ProviderVersionedActionInput,
  ) {
    return this.providers.makeDefault(id, body.rowVersion);
  }

  @Post(':id/test')
  @PlatformPermission('platform.whatsapp_providers.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'One authenticated GET to the provider; the answer never echoes a secret',
  })
  test(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(testWhatsappProviderSchema)) body: TestWhatsappProviderInput,
  ) {
    return this.providers.test(id, body);
  }
}
