import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  flagWorkspaceRequestSchema,
  impersonateRequestSchema,
  inboxAuditQuerySchema,
  inboxQueueQuerySchema,
  platformNoteRequestSchema,
  suspendWorkspaceRequestSchema,
  uuidSchema,
  type FlagWorkspaceRequest,
  type ImpersonateRequest,
  type InboxAuditQuery,
  type InboxQueueQuery,
  type PlatformNoteRequest,
  type SuspendWorkspaceRequest,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard } from '../auth';
import { PlatformPermission, PlatformPermissionGuard } from '../roles-permissions';
import { PlatformInboxService } from './platform-inbox.service';

const id = () => Param('id', zodPipe(uuidSchema));

/**
 * The platform inbox (TW-SUPP-037..046). Each route demands the `platform.*` permission Reference checked (bootstrap checks
 * none and only reports the caller's keys); Platform Support and Auditor staff reach exactly the routes their role grants.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard, PlatformPermissionGuard)
@Controller({ path: 'platform/inbox', version: '2' })
export class PlatformInboxController {
  constructor(private readonly inbox: PlatformInboxService) {}

  @Get('bootstrap')
  @ApiOperation({ summary: 'Permissions of the caller, workspaces with open/breach counts, KPIs' })
  bootstrap() {
    return this.inbox.bootstrap();
  }

  @Get('queue')
  @PlatformPermission('platform.conversation.view_all')
  @ApiOperation({ summary: 'Cross-workspace conversation queue' })
  queue(@Query(zodPipe(inboxQueueQuerySchema)) q: InboxQueueQuery) {
    return this.inbox.queue(q);
  }

  @Get('conversations/:id')
  @PlatformPermission('platform.conversation.view_all')
  @ApiOperation({ summary: 'Read-only conversation drawer' })
  conversation(@id() uuid: string) {
    return this.inbox.conversation(uuid);
  }

  @Post('conversations/:id/notes')
  @PlatformPermission('platform.note.write')
  @ApiOperation({ summary: 'Add a platform-only note' })
  addNote(@id() uuid: string, @Body(zodPipe(platformNoteRequestSchema)) body: PlatformNoteRequest) {
    return this.inbox.addNote(uuid, body);
  }

  @Post('conversations/:id/spam')
  @PlatformPermission('platform.conversation.flag_spam')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a conversation as spam' })
  spam(@id() uuid: string) {
    return this.inbox.flagSpam(uuid);
  }

  @Post('workspaces/:id/flags')
  @PlatformPermission('platform.workspace.flag')
  @ApiOperation({ summary: 'Flag a workspace' })
  flag(@id() uuid: string, @Body(zodPipe(flagWorkspaceRequestSchema)) body: FlagWorkspaceRequest) {
    return this.inbox.flagWorkspace(uuid, body);
  }

  @Delete('flags/:id')
  @PlatformPermission('platform.workspace.unflag')
  @ApiOperation({ summary: 'Clear a workspace flag' })
  clearFlag(@id() uuid: string) {
    return this.inbox.clearFlag(uuid);
  }

  @Post('workspaces/:id/suspend')
  @PlatformPermission('platform.workspace.suspend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Suspend a workspace' })
  suspend(
    @id() uuid: string,
    @Body(zodPipe(suspendWorkspaceRequestSchema)) body: SuspendWorkspaceRequest,
  ) {
    return this.inbox.suspend(uuid, body);
  }

  @Post('workspaces/:id/unsuspend')
  @PlatformPermission('platform.workspace.unsuspend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Lift a workspace suspension' })
  unsuspend(@id() uuid: string) {
    return this.inbox.unsuspend(uuid);
  }

  @Get('audit')
  @PlatformPermission('platform.audit.view')
  @ApiOperation({ summary: 'Platform actions feed' })
  audit(@Query(zodPipe(inboxAuditQuerySchema)) q: InboxAuditQuery) {
    return this.inbox.auditFeed(q);
  }

  @Post('workspaces/:id/impersonate')
  @PlatformPermission('platform.workspace.impersonate')
  @ApiOperation({
    summary: 'Start impersonating a workspace owner (the same session as the Workspaces hub)',
  })
  impersonate(
    @id() uuid: string,
    @Body(zodPipe(impersonateRequestSchema)) body: ImpersonateRequest,
  ) {
    return this.inbox.impersonate(uuid, body);
  }
}
