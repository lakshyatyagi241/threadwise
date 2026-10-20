import { Module } from '@nestjs/common';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { PlatformSupportDeskModule } from '../platform-support-desk';
import { RolesPermissionsModule } from '../roles-permissions';
import { WalletMessageBillingModule } from '../wallet-message-billing';
import { WhatsAppProviderRegistryModule } from '../whatsapp-provider-registry';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { MembersController } from './members.controller';
import { MembersRepository } from './members.repository';
import { MembersService } from './members.service';
import { LeaveController } from './leave/leave.controller';
import { LeaveRepository } from './leave/leave.repository';
import { LeaveService } from './leave/leave.service';
import { LifecycleRepository } from './lifecycle/lifecycle.repository';
import { LifecycleService } from './lifecycle/lifecycle.service';
import { PlatformWorkspaceLifecycleController } from './platform-workspace-lifecycle.controller';
import { PlatformWorkspacesController } from './platform-workspaces.controller';
import { PlatformWorkspacesRepository } from './platform-workspaces.repository';
import { PlatformWorkspacesService } from './platform-workspaces.service';
import { TeamsController } from './teams.controller';
import { TeamsPlanService } from './teams-plan.service';
import { TeamsRepository } from './teams.repository';
import { TeamsService } from './teams.service';

/**
 * Workspace members and teams (WSP, TW-WSP-015..022, 046). Who may hand out which role is the RBAC domain's
 * `WorkspaceRoleRulesService`. Kernel services (audit, outbox, RBAC), the database, Redis and the
 * auth services (mail, one-time tokens, sessions, sign-in) are global. The operator Workspaces hub (TW-WSP-023/025) reads across
 * workspaces through the platform door and suspends through the platform inbox.
 */
@Module({
  imports: [
    PlansCoreModule,
    RolesPermissionsModule,
    PlatformSupportDeskModule,
    WalletMessageBillingModule,
    WhatsAppProviderRegistryModule,
  ],
  controllers: [
    MembersController,
    LeaveController,
    TeamsController,
    InvitationsController,
    PlatformWorkspacesController,
    PlatformWorkspaceLifecycleController,
  ],
  providers: [
    MembersRepository,
    MembersService,
    LeaveRepository,
    LeaveService,
    TeamsRepository,
    TeamsPlanService,
    TeamsService,
    InvitationsService,
    PlatformWorkspacesRepository,
    PlatformWorkspacesService,
    LifecycleRepository,
    LifecycleService,
  ],
  exports: [MembersService, TeamsService, TeamsPlanService, PlatformWorkspacesService, LifecycleService],
})
export class WorkspacesTeamsTenancyModule {}
