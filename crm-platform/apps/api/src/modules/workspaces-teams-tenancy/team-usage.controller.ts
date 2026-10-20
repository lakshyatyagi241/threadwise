import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { TeamUsageService } from './team-usage.service';

/**
 * What deleting a team would change (BL-380). A separate controller from the teams CRUD so the preview does not depend on how that
 * controller is gated: it needs the same right as the delete it previews.
 */
@ApiTags('workspace-teams')
@ActorKinds('user')
@Controller({ path: 'workspace/teams', version: '2' })
export class TeamUsageController {
  constructor(private readonly usage: TeamUsageService) {}

  @Get(':id/usage')
  @RequirePermission('inbox.team.manage')
  @ApiOperation({
    summary: 'What deleting the team changes',
    description:
      'Counts of what refers to the team: routing rules, record assignment rules, shared segments, assigned conversations, and the people whose "team records" reach shrinks. Read-only.',
  })
  async forTeam(@Param('id', ParseUUIDPipe) id: string) {
    return this.usage.forTeam(id);
  }
}
