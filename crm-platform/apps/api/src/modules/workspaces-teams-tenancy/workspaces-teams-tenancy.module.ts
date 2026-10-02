import { Module } from '@nestjs/common';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { RolesPermissionsModule } from '../roles-permissions';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { MembersController } from './members.controller';
import { MembersRepository } from './members.repository';
import { MembersService } from './members.service';
import { TeamsController } from './teams.controller';
import { TeamsRepository } from './teams.repository';
import { TeamsService } from './teams.service';

/**
 * Workspace members and teams (WSP, WD-WSP-015..022, 046). Who may hand out which role is the RBAC domain's
 * `WorkspaceRoleRulesService`. Kernel services (audit, outbox, RBAC), the database, Redis and the
 * auth services (mail, one-time tokens, sessions, sign-in) are global.
 */
@Module({
  imports: [PlansCoreModule, RolesPermissionsModule],
  controllers: [MembersController, TeamsController, InvitationsController],
  providers: [MembersRepository, MembersService, TeamsRepository, TeamsService, InvitationsService],
  exports: [MembersService, TeamsService],
})
export class WorkspacesTeamsTenancyModule {}
