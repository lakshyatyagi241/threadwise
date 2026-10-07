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
import { PlatformWorkspacesController } from './platform-workspaces.controller';
import { PlatformWorkspacesRepository } from './platform-workspaces.repository';
import { PlatformWorkspacesService } from './platform-workspaces.service';
import { TeamsController } from './teams.controller';
import { TeamsRepository } from './teams.repository';
import { TeamsService } from './teams.service';

/**
 * Workspace members and teams (WSP, WD-WSP-015..022, 046). Who may hand out which role is the RBAC domain's
 * `WorkspaceRoleRulesService`. Kernel services (audit, outbox, RBAC), the database, Redis and the
 * auth services (mail, one-time tokens, sessions, sign-in) are global. The operator Workspaces hub (WD-WSP-023/025) reads across
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
    TeamsController,
    InvitationsController,
    PlatformWorkspacesController,
  ],
  providers: [
    MembersRepository,
    MembersService,
    TeamsRepository,
    TeamsService,
    InvitationsService,
    PlatformWorkspacesRepository,
    PlatformWorkspacesService,
  ],
  exports: [MembersService, TeamsService, PlatformWorkspacesService],
})
export class WorkspacesTeamsTenancyModule {}
