import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorKinds } from '../../common/decorators';
import { OperatorGuard } from '../auth';
import { PlatformPermission, PlatformPermissionGuard } from '../roles-permissions';
import { ConferencingOperatorService } from './conferencing-operator.service';

/**
 * Operator console: what Zoom and Microsoft Teams still need before a workspace can use them (`/v2/platform/conferencing/status`). Read-only,
 * for the people who run or review the Marketplace catalogue (the checklist sits on the two listings' pages).
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard, PlatformPermissionGuard)
@Controller({ path: 'platform/conferencing', version: '2' })
export class ConferencingOperatorController {
  constructor(private readonly operator: ConferencingOperatorService) {}

  @Get('status')
  @PlatformPermission('platform.market.manage', 'platform.market.review')
  @ApiOperation({
    summary:
      'What each video provider still needs: credentials set, listing published, the redirect address to register',
    description:
      'Per provider: whether the client id and secret are set and where they come from, whether the Microsoft Calendar integration is switched off (Teams), the listing status, the exact redirect URI built from APP_URL (or its override), and the list of gaps. Values are never returned.',
  })
  status() {
    return this.operator.status();
  }
}
