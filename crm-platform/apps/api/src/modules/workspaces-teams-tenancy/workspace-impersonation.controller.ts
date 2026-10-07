import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  startImpersonationRequestSchema,
  uuidSchema,
  type StartImpersonationRequest,
  type StartImpersonationResponse,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ImpersonationService, OperatorGuard, OperatorRoles } from '../auth';
import { PlatformPermission, PlatformPermissionGuard } from '../roles-permissions';

/**
 * "Login as owner" (TW-WSP-032): an operator starts an act-as session in a workspace. Two locks, as Reference's group middleware
 * plus Spatie permission were: the `platform.workspace.impersonate` permission AND the super admin role (Reference let Platform
 * Support hold the permission but not reach the route; here the role is explicit). The session, the token and the rules around
 * it belong to the auth domain's `ImpersonationService`.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard, PlatformPermissionGuard)
@Controller({ path: 'platform/workspaces', version: '2' })
export class WorkspaceImpersonationController {
  constructor(private readonly impersonation: ImpersonationService) {}

  @Post(':id/impersonate')
  @PlatformPermission('platform.workspace.impersonate')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Start acting as the workspace owner',
    description:
      'Returns a one-time handoff URL (60 seconds, single use). Ends any session this operator already has open.',
  })
  start(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(startImpersonationRequestSchema)) body: StartImpersonationRequest,
  ): Promise<StartImpersonationResponse> {
    return this.impersonation.start(id, body);
  }
}
